import { defineTool } from "eve/tools";
import { z } from "zod";

type GeocodeResult = {
  name: string;
  latitude: number;
  longitude: number;
  timezone?: string;
  country?: string;
  admin1?: string;
};

type ForecastDaily = {
  time: string[];
  uv_index_max: (number | null)[];
  sunrise: (string | null)[];
  sunset: (string | null)[];
};

type ForecastHourly = {
  time: string[];
  cloud_cover: (number | null)[];
};

type GeocodeApiResult = GeocodeResult & {
  postcodes?: string[];
  country_code?: string;
};

type CloudVsNormal =
  | "much sunnier than normal"
  | "sunnier than normal"
  | "about normal"
  | "cloudier than normal"
  | "much cloudier than normal";

type SunsetCloudNote = "should be clear" | "should be cloudy";

function formatPlace(result: GeocodeResult): string {
  return [result.name, result.admin1, result.country].filter(Boolean).join(", ");
}

function formatSunset(isoLocal: string): string {
  const timePart = isoLocal.includes("T") ? isoLocal.split("T")[1] : isoLocal;
  const [hourRaw, minuteRaw = "00"] = timePart.split(":");
  const hour = Number(hourRaw);
  if (!Number.isFinite(hour)) return isoLocal;
  const minute = minuteRaw.slice(0, 2);
  const period = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${hour12}:${minute}${period}`;
}

function isUsZip(location: string): boolean {
  return /^\d{5}(?:-\d{4})?$/.test(location.trim());
}

function resolveLocation(location: string | undefined): string {
  const override = location?.trim();
  if (override) return override;

  const fromEnv = process.env.DEFAULT_LOCATION?.trim();
  if (fromEnv) return fromEnv;

  throw new Error(
    "No location provided and DEFAULT_LOCATION is not set. Pass a location or configure the env var.",
  );
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function cloudCoverVsNormal(today: number, normal: number): CloudVsNormal {
  const delta = today - normal;
  if (delta <= -25) return "much sunnier than normal";
  if (delta <= -10) return "sunnier than normal";
  if (delta >= 25) return "much cloudier than normal";
  if (delta >= 10) return "cloudier than normal";
  return "about normal";
}

function sunsetCloudNote(cloudCover: number): SunsetCloudNote | null {
  if (cloudCover <= 20) return "should be clear";
  if (cloudCover >= 70) return "should be cloudy";
  return null;
}

/** Nearest hourly cloud cover for the sunset hour. */
function cloudCoverNearTime(
  hourly: ForecastHourly,
  isoLocal: string,
): number | null {
  const hourKey = isoLocal.slice(0, 13);
  for (let i = 0; i < hourly.time.length; i++) {
    if (hourly.time[i].slice(0, 13) === hourKey && hourly.cloud_cover[i] != null) {
      return hourly.cloud_cover[i];
    }
  }

  let best: number | null = null;
  for (let i = 0; i < hourly.time.length; i++) {
    const cover = hourly.cloud_cover[i];
    if (cover == null) continue;
    if (hourly.time[i] <= isoLocal) best = cover;
  }
  return best;
}

function daytimeCloudCoverMean(
  hourly: ForecastHourly,
  sunriseIso: string | null,
  sunsetIso: string | null,
): number | null {
  if (!sunriseIso || !sunsetIso) {
    return mean(
      hourly.cloud_cover.filter((value): value is number => value != null),
    );
  }

  const startHour = sunriseIso.slice(0, 13);
  const endHour = sunsetIso.slice(0, 13);
  const values: number[] = [];
  for (let i = 0; i < hourly.time.length; i++) {
    const hour = hourly.time[i].slice(0, 13);
    const cover = hourly.cloud_cover[i];
    if (cover == null) continue;
    if (hour >= startHour && hour <= endHour) values.push(cover);
  }
  return mean(values);
}

async function geocode(location: string, signal: AbortSignal): Promise<GeocodeResult> {
  const query = location.trim();
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", query);
  url.searchParams.set("count", "5");
  url.searchParams.set("language", "en");
  url.searchParams.set("format", "json");
  if (isUsZip(query)) {
    url.searchParams.set("countryCode", "US");
  }

  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`Geocoding failed (${response.status})`);
  }

  const data = (await response.json()) as { results?: GeocodeApiResult[] };
  const results = data.results ?? [];
  const zip = isUsZip(query) ? query.slice(0, 5) : null;
  const match =
    (zip
      ? results.find((result) => result.postcodes?.includes(zip))
      : undefined) ?? results[0];
  if (!match) {
    throw new Error(`Could not find a place named "${location}"`);
  }
  return match;
}

async function monthlyCloudCoverNormal(
  latitude: number,
  longitude: number,
  date: string,
  timezone: string,
  signal: AbortSignal,
): Promise<number | null> {
  const [yearRaw, monthRaw] = date.split("-").map(Number);
  const year = yearRaw;
  const month = monthRaw;
  const startYear = year - 10;
  const endYear = year - 1;
  const monthKey = pad2(month);

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  url.searchParams.set("start_date", `${startYear}-${monthKey}-01`);
  url.searchParams.set(
    "end_date",
    `${endYear}-${monthKey}-${pad2(lastDayOfMonth(endYear, month))}`,
  );
  url.searchParams.set("daily", "cloud_cover_mean");
  url.searchParams.set("timezone", timezone);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    // Archive rate limits are common on the free tier; skip the normal.
    return null;
  }

  const data = (await response.json()) as {
    daily?: {
      time?: string[];
      cloud_cover_mean?: (number | null)[];
    };
  };

  const times = data.daily?.time ?? [];
  const covers = data.daily?.cloud_cover_mean ?? [];
  const values: number[] = [];
  for (let i = 0; i < times.length; i++) {
    const cover = covers[i];
    if (cover == null) continue;
    if (times[i].slice(5, 7) === monthKey) values.push(cover);
  }

  return mean(values);
}

export default defineTool({
  description:
    "Get today's peak UV index, daytime-average cloud cover vs a 10-year monthly normal, sunset time, and whether sunset skies look notably clear or cloudy. Omit location to use the configured default; pass a zip, city, or city/state to override for this call.",
  inputSchema: z.object({
    location: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Optional override: zip code, city, or city/state. Omit to use DEFAULT_LOCATION.",
      ),
  }),
  outputSchema: z.object({
    placeName: z.string(),
    location: z.string(),
    date: z.string(),
    timezone: z.string(),
    uvIndexMax: z.number().nullable(),
    cloudCoverMean: z.number().nullable(),
    cloudCoverNormal: z.number().nullable(),
    cloudCoverVsNormal: z
      .enum([
        "much sunnier than normal",
        "sunnier than normal",
        "about normal",
        "cloudier than normal",
        "much cloudier than normal",
      ])
      .nullable(),
    sunset: z.string().nullable(),
    sunsetLocal: z.string().nullable(),
    sunsetCloudCover: z.number().nullable(),
    sunsetCloudNote: z.enum(["should be clear", "should be cloudy"]).nullable(),
  }),
  async execute({ location }, ctx) {
    const place = await geocode(resolveLocation(location), ctx.abortSignal);

    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", String(place.latitude));
    url.searchParams.set("longitude", String(place.longitude));
    url.searchParams.set("daily", "uv_index_max,sunrise,sunset");
    url.searchParams.set("hourly", "cloud_cover");
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("forecast_days", "1");

    const response = await fetch(url, { signal: ctx.abortSignal });
    if (!response.ok) {
      throw new Error(`Forecast request failed (${response.status})`);
    }

    const data = (await response.json()) as {
      timezone: string;
      daily: ForecastDaily;
      hourly: ForecastHourly;
    };

    const date = data.daily.time[0];
    const sunriseIso = data.daily.sunrise[0] ?? null;
    const sunsetIso = data.daily.sunset[0] ?? null;

    const cloudCoverMeanRaw = daytimeCloudCoverMean(
      data.hourly,
      sunriseIso,
      sunsetIso,
    );
    const cloudCoverMean =
      cloudCoverMeanRaw == null ? null : Math.round(cloudCoverMeanRaw);

    const sunsetCloudCoverRaw = sunsetIso
      ? cloudCoverNearTime(data.hourly, sunsetIso)
      : null;
    const sunsetCloudCover =
      sunsetCloudCoverRaw == null ? null : Math.round(sunsetCloudCoverRaw);

    const cloudCoverNormalRaw = await monthlyCloudCoverNormal(
      place.latitude,
      place.longitude,
      date,
      data.timezone,
      ctx.abortSignal,
    );
    const cloudCoverNormal =
      cloudCoverNormalRaw == null ? null : Math.round(cloudCoverNormalRaw);

    return {
      placeName: place.name,
      location: formatPlace(place),
      date,
      timezone: data.timezone,
      uvIndexMax: data.daily.uv_index_max[0] ?? null,
      cloudCoverMean,
      cloudCoverNormal,
      cloudCoverVsNormal:
        cloudCoverMean == null || cloudCoverNormal == null
          ? null
          : cloudCoverVsNormal(cloudCoverMean, cloudCoverNormal),
      sunset: sunsetIso,
      sunsetLocal: sunsetIso ? formatSunset(sunsetIso) : null,
      sunsetCloudCover,
      sunsetCloudNote:
        sunsetCloudCover == null ? null : sunsetCloudNote(sunsetCloudCover),
    };
  },
});
