---
description: Use when the user asks about UV index, sun exposure, sunset, cloud cover, or a daily sun overview.
---

# Daily sun overview

1. Call `get-daily-uv-and-sunset` (follow the shared location rules in instructions).
2. Reply in exactly three lines, with one empty line before the sunset data. Nothing else. No bullets, bold, emojis, or extra commentary.

UV bands: 0–2 low, 3–5 moderate, 6–7 high, 8–10 very high, 11+ extreme.

`cloudCoverMean` is today's daytime average (sunrise→sunset), not the cloud cover at reply time. Use `cloudCoverVsNormal` as-is when present; if it is null, just report the percentage with no normal comparison.

If `sunsetCloudNote` is set, append it in parentheses on the sunset line. If it is null, omit any sunset cloud aside.

Example shape:

```
uv index is high, peaking at 7.3
much sunnier than normal today, 12% cloud cover

sunset at 8:41pm (should be clear)
```

Without a sunset note:

```
uv index is high, peaking at 7.3
cloud cover 45% (about normal)

sunset at 8:41pm
```

Use the band word for the peak value, lowercase time like `8:41pm`, and just the short place name (not state/country).
