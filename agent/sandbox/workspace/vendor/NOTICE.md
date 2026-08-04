Vendored from [BrunoJurkovic/storygraph-wrapper](https://github.com/BrunoJurkovic/storygraph-wrapper) (MIT).

Not published to PyPI at the time of vendoring, so the `storygraph` package source is included here for the eve sandbox / local Python runner.

Patches vs upstream:
- `http.py` uses `curl_cffi` chrome impersonation instead of `cloudscraper` (blocked by current Cloudflare).
- BeautifulSoup uses `html.parser` instead of `lxml` (avoids native libxml2 builds in the sandbox).
