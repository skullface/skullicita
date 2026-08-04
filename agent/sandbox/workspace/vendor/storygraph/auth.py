"""Authentication module for StoryGraph API."""

import re
import warnings
from typing import Any, Optional
import httpx
from bs4 import BeautifulSoup

from storygraph.exceptions import AuthenticationError, ParseError


class AuthManager:
    """Handles authentication and session management for StoryGraph."""

    def __init__(self, client: Any, base_url: str):
        """
        Initialize auth manager.

        Args:
            client: Async HTTP client instance (AsyncCloudScraper or compatible)
            base_url: Base URL for StoryGraph
        """
        self.client = client
        self.base_url = base_url
        self.csrf_token: Optional[str] = None
        self.user_id: Optional[str] = None
        self._is_authenticated = False

    async def initialize_from_cookies(self) -> bool:
        """
        Initialize authentication from existing session cookies.

        This method assumes cookies are already set in the httpx client.
        It fetches the homepage to extract the CSRF token.

        Returns:
            True if initialization successful

        Raises:
            AuthenticationError: If unable to fetch CSRF token
            ParseError: If unable to parse homepage
        """
        try:
            # Fetch homepage to get CSRF token
            response = await self.client.get(self.base_url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # Extract CSRF token from meta tag
            csrf_meta = soup.find("meta", {"name": "csrf-token"})

            if csrf_meta and "content" in csrf_meta.attrs:
                self.csrf_token = csrf_meta["content"]
            else:
                raise ParseError("Could not find CSRF token in homepage")

            # Extract user ID if available
            user_pattern = re.search(r"user_id=([a-f0-9-]+)", response.text)
            if user_pattern:
                self.user_id = user_pattern.group(1)

            self._is_authenticated = True
            return True

        except httpx.HTTPError as e:
            raise AuthenticationError(f"HTTP error during cookie initialization: {e}") from e
        except Exception as e:
            if isinstance(e, (AuthenticationError, ParseError)):
                raise
            raise AuthenticationError(f"Unexpected error during cookie initialization: {e}") from e

    async def login(self, email: str, password: str) -> bool:
        """
        Authenticate with StoryGraph using email and password.

        ⚠️ DEPRECATED: This method is blocked by Cloudflare protection and will not work.
        Use session cookie authentication instead. See README for instructions on
        extracting your session cookie from the browser.

        Args:
            email: User email address
            password: User password

        Returns:
            True if authentication successful

        Raises:
            AuthenticationError: If login fails (likely due to Cloudflare protection)
            ParseError: If unable to parse login page
        """
        warnings.warn(
            "login() is deprecated and blocked by Cloudflare protection. "
            "Use session cookie authentication instead. "
            "See README for instructions on extracting your session cookie.",
            DeprecationWarning,
            stacklevel=2
        )
        try:
            # Step 1: Get login page to extract CSRF token
            response = await self.client.get(f"{self.base_url}/users/sign_in")
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # Extract CSRF token from form
            csrf_input = soup.find("input", {"name": "authenticity_token"})
            if not csrf_input or "value" not in csrf_input.attrs:
                raise ParseError("Could not find CSRF token in login page")

            csrf_token = csrf_input["value"]

            # Step 2: Submit login form
            login_data = {
                "authenticity_token": csrf_token,
                "user[email]": email,
                "user[password]": password,
                "user[remember_me]": "0",
                "commit": "Sign in",
            }

            # Add headers that mimic a real browser form submission
            login_headers = {
                "Origin": self.base_url,
                "Referer": f"{self.base_url}/users/sign_in",
                "Content-Type": "application/x-www-form-urlencoded",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "same-origin",
                "Sec-Fetch-User": "?1",
            }

            response = await self.client.post(
                f"{self.base_url}/users/sign_in",
                data=login_data,
                headers=login_headers,
                follow_redirects=True
            )

            # Check if login was successful (should redirect to homepage)
            if response.status_code != 200 or "/users/sign_in" in str(response.url):
                raise AuthenticationError("Invalid email or password")

            # Step 3: Extract new CSRF token from redirected page
            soup = BeautifulSoup(response.text, "html.parser")
            csrf_meta = soup.find("meta", {"name": "csrf-token"})

            if csrf_meta and "content" in csrf_meta.attrs:
                self.csrf_token = csrf_meta["content"]
            else:
                raise ParseError("Could not find CSRF token after login")

            # Extract user ID if available
            user_pattern = re.search(r"user_id=([a-f0-9-]+)", response.text)
            if user_pattern:
                self.user_id = user_pattern.group(1)

            self._is_authenticated = True
            return True

        except httpx.HTTPError as e:
            raise AuthenticationError(f"HTTP error during login: {e}") from e
        except Exception as e:
            if isinstance(e, (AuthenticationError, ParseError)):
                raise
            raise AuthenticationError(f"Unexpected error during login: {e}") from e

    async def logout(self) -> bool:
        """
        Log out from StoryGraph.

        Returns:
            True if logout successful
        """
        try:
            if not self.csrf_token:
                return True

            response = await self.client.delete(
                f"{self.base_url}/users/sign_out",
                headers={"x-csrf-token": self.csrf_token},
                follow_redirects=True,
            )

            self.csrf_token = None
            self.user_id = None
            self._is_authenticated = False

            return response.status_code == 200

        except httpx.HTTPError:
            # Even if logout fails, clear local state
            self.csrf_token = None
            self.user_id = None
            self._is_authenticated = False
            return False

    def is_authenticated(self) -> bool:
        """Check if currently authenticated."""
        return self._is_authenticated and self.csrf_token is not None

    def get_csrf_token(self) -> Optional[str]:
        """Get current CSRF token."""
        return self.csrf_token

    def get_user_id(self) -> Optional[str]:
        """Get current user ID."""
        return self.user_id
