"""Async HTTP client using curl_cffi to bypass Cloudflare protection.

Patched from BrunoJurkovic/storygraph-wrapper: upstream cloudscraper is blocked
by current Cloudflare challenges; curl_cffi chrome impersonation works.
"""

from __future__ import annotations

import asyncio
from typing import Any

import httpx
from curl_cffi import requests as curl_requests


class AsyncCloudScraper:
    """
    Async adapter wrapping curl_cffi (sync/requests-compatible).

    Presents the same interface the endpoints expect: async .get(), .post(),
    .delete() returning objects with .text, .status_code, .raise_for_status(), .url.
    """

    def __init__(
        self,
        timeout: float = 30.0,
        follow_redirects: bool = True,
        cookies: dict[str, str] | None = None,
    ):
        # Pin a concrete Chrome JA3/profile. Generic "chrome" tracks latest and
        # currently gets Cloudflare-challenged (HTTP 403 "Just a moment...").
        self._session = curl_requests.Session(impersonate="chrome131")
        self._timeout = timeout
        self._follow_redirects = follow_redirects

        if cookies:
            self._session.cookies.update(cookies)

    async def get(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("allow_redirects", self._follow_redirects)
        kwargs.setdefault("timeout", self._timeout)
        return await self._run(self._session.get, url, **kwargs)

    async def post(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("allow_redirects", self._follow_redirects)
        kwargs.setdefault("timeout", self._timeout)
        return await self._run(self._session.post, url, **kwargs)

    async def delete(self, url: str, **kwargs: Any) -> Any:
        kwargs.setdefault("allow_redirects", self._follow_redirects)
        kwargs.setdefault("timeout", self._timeout)
        return await self._run(self._session.delete, url, **kwargs)

    async def _run(self, method: Any, *args: Any, **kwargs: Any) -> Any:
        # Convert httpx-style 'follow_redirects' to requests-style 'allow_redirects'
        if "follow_redirects" in kwargs:
            kwargs["allow_redirects"] = kwargs.pop("follow_redirects")

        try:
            return await asyncio.to_thread(method, *args, **kwargs)
        except curl_requests.RequestsError as e:
            raise httpx.HTTPError(str(e)) from e
        except Exception as e:
            # curl_cffi may raise requests-compatible errors or OSError variants
            if e.__class__.__module__.startswith("curl_cffi") or e.__class__.__module__.startswith(
                "requests"
            ):
                raise httpx.HTTPError(str(e)) from e
            raise

    async def aclose(self) -> None:
        close = getattr(self._session, "close", None)
        if callable(close):
            close()
