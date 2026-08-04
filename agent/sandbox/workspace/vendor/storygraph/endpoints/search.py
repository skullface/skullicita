"""Search endpoint module."""

from typing import Any

import httpx
from bs4 import BeautifulSoup

from storygraph.models.book import BookSearchResult
from storygraph.exceptions import ParseError


class SearchEndpoint:
    """Handles book search functionality."""

    def __init__(self, client: Any, base_url: str, auth_manager: Any):
        """
        Initialize search endpoint.

        Args:
            client: Async HTTP client instance
            base_url: Base URL for StoryGraph
            auth_manager: Authentication manager instance
        """
        self.client = client
        self.base_url = base_url
        self.auth = auth_manager

    async def search_books(self, query: str, limit: int = 20) -> list[BookSearchResult]:
        """
        Search for books by title or author.

        Args:
            query: Search query (title or author name)
            limit: Maximum number of results to return

        Returns:
            List of BookSearchResult objects

        Raises:
            ParseError: If unable to parse search results
        """
        if not query.strip():
            return []

        try:
            response = await self.client.get(
                f"{self.base_url}/search",
                params={"search_term": query, "button": ""},
                headers={"turbo-frame": "search_results"},
            )

            response.raise_for_status()

            # Parse search results
            soup = BeautifulSoup(response.text, "html.parser")

            books = []
            # Look for the listbox containing search results
            listbox = soup.find("ul", role="listbox")
            if not listbox:
                return []

            # Find all book option links
            book_links = listbox.find_all("a", class_="book-list-option", limit=limit)

            for link in book_links:
                href = link.get("href", "")
                if "/books/" not in href:
                    continue

                # Extract book ID from URL
                book_id = href.split("/books/")[1].split("?")[0]

                # Extract title from h1 > span
                title = None
                title_h1 = link.find("h1", class_=lambda c: c and "hidden" not in str(c))
                if title_h1:
                    title_span = title_h1.find("span")
                    if title_span:
                        title = title_span.get_text(strip=True)

                # Extract author from h2
                author = None
                author_h2 = link.find("h2")
                if author_h2:
                    author = author_h2.get_text(strip=True)

                # Extract cover URL from img
                cover_url = None
                img = link.find("img")
                if img and "src" in img.attrs:
                    cover_url = img["src"]

                if not title or not book_id:
                    continue

                book_data = {
                    "id": book_id,
                    "title": title,
                    "author": author,
                    "cover_url": cover_url,
                }

                books.append(BookSearchResult(**book_data))

            return books[:limit]

        except httpx.HTTPError as e:
            raise ParseError(f"Error searching books: {e}") from e

    async def search_books_by_author(self, author: str, limit: int = 20) -> list[BookSearchResult]:
        """
        Search for books by a specific author.

        Args:
            author: Author name
            limit: Maximum number of results

        Returns:
            List of BookSearchResult objects
        """
        return await self.search_books(author, limit)

    async def search_books_by_title(self, title: str, limit: int = 20) -> list[BookSearchResult]:
        """
        Search for books by title.

        Args:
            title: Book title
            limit: Maximum number of results

        Returns:
            List of BookSearchResult objects
        """
        return await self.search_books(title, limit)
