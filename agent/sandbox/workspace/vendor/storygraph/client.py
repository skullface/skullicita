"""Main StoryGraph API client."""

from typing import Optional

from storygraph.auth import AuthManager
from storygraph.http import AsyncCloudScraper
from storygraph.endpoints.books import BooksEndpoint
from storygraph.endpoints.reading import ReadingEndpoint
from storygraph.endpoints.search import SearchEndpoint
from storygraph.models.book import Book, BookSearchResult
from storygraph.models.progress import ProgressType
from storygraph.exceptions import StoryGraphError


class StoryGraphClient:
    """
    Async client for interacting with The StoryGraph.

    Example:
        ```python
        from storygraph import StoryGraphClient

        async with StoryGraphClient() as client:
            await client.login("email@example.com", "password")

            # Update reading progress
            await client.update_progress("book-uuid", 75, ProgressType.PERCENT)

            # Search for books
            results = await client.search("1984")

            # Get book details
            book = await client.get_book("book-uuid")
        ```
    """

    def __init__(
        self,
        base_url: str = "https://app.thestorygraph.com",
        timeout: float = 30.0,
        max_retries: int = 3,
        session_cookie: Optional[str] = None,
    ):
        """
        Initialize StoryGraph client.

        Args:
            base_url: Base URL for StoryGraph (default: https://app.thestorygraph.com)
            timeout: Request timeout in seconds
            max_retries: Maximum number of retries for failed requests
            session_cookie: Optional session cookie for authentication.
                          Extract from browser after logging in manually.
                          Example: "_storygraph_session=your_cookie_value"
        """
        self.base_url = base_url.rstrip("/")

        # Prepare cookies dict
        cookies_dict = {}
        if session_cookie:
            cookies_dict["_storygraph_session"] = session_cookie

        # Create HTTP client using cloudscraper to bypass Cloudflare
        self._client = AsyncCloudScraper(
            timeout=timeout,
            follow_redirects=True,
            cookies=cookies_dict,
        )

        self._session_cookie_provided = session_cookie is not None

        # Initialize managers and endpoints
        self.auth = AuthManager(self._client, self.base_url)
        self.books = BooksEndpoint(self._client, self.base_url, self.auth)
        self.reading = ReadingEndpoint(self._client, self.base_url, self.auth)
        self.search_endpoint = SearchEndpoint(self._client, self.base_url, self.auth)

        # If session cookie was provided, set up authentication
        self._cookie_auth_initialized = False
        if self._session_cookie_provided:
            # We'll initialize auth lazily on first API call to avoid blocking __init__
            pass

    async def __aenter__(self) -> "StoryGraphClient":
        """Async context manager entry."""
        # Initialize cookie-based auth if session cookie was provided
        if self._session_cookie_provided and not self._cookie_auth_initialized:
            await self._initialize_cookie_auth()
        return self

    async def _initialize_cookie_auth(self) -> None:
        """Initialize authentication from session cookie by fetching CSRF token."""
        if self._cookie_auth_initialized:
            return
        try:
            await self.auth.initialize_from_cookies()
            self._cookie_auth_initialized = True
        except Exception as e:
            raise StoryGraphError(f"Failed to initialize authentication from cookie: {e}") from e

    async def __aexit__(self, exc_type: any, exc_val: any, exc_tb: any) -> None:
        """Async context manager exit."""
        await self.close()

    async def close(self) -> None:
        """Close the HTTP client."""
        await self._client.aclose()

    # Authentication methods
    async def login(self, email: str, password: str) -> bool:
        """
        Log in to StoryGraph.

        Args:
            email: User email address
            password: User password

        Returns:
            True if login successful

        Raises:
            AuthenticationError: If login fails
        """
        return await self.auth.login(email, password)

    async def logout(self) -> bool:
        """
        Log out from StoryGraph.

        Returns:
            True if logout successful
        """
        return await self.auth.logout()

    def is_authenticated(self) -> bool:
        """Check if currently authenticated."""
        return self.auth.is_authenticated()

    # Book methods
    async def get_book(self, book_id: str) -> Book:
        """
        Get detailed information about a book.

        Args:
            book_id: Book UUID

        Returns:
            Book object with detailed information

        Raises:
            BookNotFoundError: If book doesn't exist
        """
        return await self.books.get_book(book_id)

    # Reading progress methods
    async def update_progress(
        self,
        book_id: str,
        progress: int,
        progress_type: ProgressType = ProgressType.PERCENT,
        note: Optional[str] = None,
    ) -> bool:
        """
        Update reading progress for a book.

        Args:
            book_id: Book UUID
            progress: Progress value (0-100 for percent, or page number)
            progress_type: Type of progress (percent or pages)
            note: Optional reading note

        Returns:
            True if update successful

        Raises:
            NotAuthenticatedError: If not logged in
            InvalidProgressError: If progress value is invalid
        """
        return await self.reading.update_progress(book_id, progress, progress_type, note)

    async def get_currently_reading(self) -> list[Book]:
        """
        Get list of currently reading books.

        Returns:
            List of Book objects

        Raises:
            NotAuthenticatedError: If not logged in
        """
        return await self.reading.get_currently_reading()

    async def get_to_read_pile(self) -> list[Book]:
        """
        Get list of books in To-Read pile.

        Returns:
            List of Book objects

        Raises:
            NotAuthenticatedError: If not logged in
        """
        return await self.reading.get_to_read_pile()

    # Search methods
    async def search(self, query: str, limit: int = 20) -> list[BookSearchResult]:
        """
        Search for books by title or author.

        Args:
            query: Search query
            limit: Maximum number of results

        Returns:
            List of BookSearchResult objects
        """
        return await self.search_endpoint.search_books(query, limit)

    async def search_by_author(self, author: str, limit: int = 20) -> list[BookSearchResult]:
        """
        Search for books by author.

        Args:
            author: Author name
            limit: Maximum number of results

        Returns:
            List of BookSearchResult objects
        """
        return await self.search_endpoint.search_books_by_author(author, limit)

    async def search_by_title(self, title: str, limit: int = 20) -> list[BookSearchResult]:
        """
        Search for books by title.

        Args:
            title: Book title
            limit: Maximum number of results

        Returns:
            List of BookSearchResult objects
        """
        return await self.search_endpoint.search_books_by_title(title, limit)

    # Convenience methods
    async def mark_as_finished(
        self, book_id: str, rating: Optional[float] = None, review: Optional[str] = None
    ) -> bool:
        """
        Mark a book as finished.

        Args:
            book_id: Book UUID
            rating: Optional rating (0.25-5.0)
            review: Optional review text

        Returns:
            True if successful

        Raises:
            NotAuthenticatedError: If not logged in
        """
        return await self.books.mark_as_finished(book_id, rating, review)

    async def add_to_tbr(self, book_id: str) -> bool:
        """
        Add a book to To-Be-Read pile.

        Args:
            book_id: Book UUID

        Returns:
            True if successful

        Raises:
            NotAuthenticatedError: If not logged in
        """
        return await self.books.add_to_tbr(book_id)
