"""Books endpoint module."""

from typing import Any, Optional
import httpx
from bs4 import BeautifulSoup

from storygraph.models.book import Book
from storygraph.exceptions import BookNotFoundError, ParseError, NotAuthenticatedError


class BooksEndpoint:
    """Handles book-related API calls."""

    def __init__(self, client: Any, base_url: str, auth_manager: Any):
        """
        Initialize books endpoint.

        Args:
            client: Async HTTP client instance
            base_url: Base URL for StoryGraph
            auth_manager: Authentication manager instance
        """
        self.client = client
        self.base_url = base_url
        self.auth = auth_manager

    async def get_book(self, book_id: str) -> Book:
        """
        Get detailed information about a book.

        Args:
            book_id: Book UUID

        Returns:
            Book object with detailed information

        Raises:
            BookNotFoundError: If book doesn't exist
            ParseError: If unable to parse book page
        """
        try:
            response = await self.client.get(f"{self.base_url}/books/{book_id}")

            if response.status_code == 404:
                raise BookNotFoundError(f"Book {book_id} not found")

            response.raise_for_status()

            # Parse the book page
            soup = BeautifulSoup(response.text, "html.parser")

            # Extract book information
            book_data = self._parse_book_page(soup, book_id)

            return Book(**book_data)

        except httpx.HTTPError as e:
            if isinstance(e, BookNotFoundError):
                raise
            raise ParseError(f"Error fetching book: {e}") from e

    def _parse_book_page(self, soup: BeautifulSoup, book_id: str) -> dict[str, any]:
        """
        Parse book page HTML to extract book data.

        Args:
            soup: BeautifulSoup object
            book_id: Book UUID

        Returns:
            Dictionary with book data
        """
        book_data: dict[str, any] = {"id": book_id}

        # Extract title and author (from h3 heading)
        heading = soup.find("h3")
        if heading:
            text = heading.get_text(strip=True)
            # Title and author are typically separated
            parts = text.rsplit(" ", 1)
            if len(parts) == 2:
                book_data["title"] = parts[0].strip()
                book_data["author"] = parts[1].strip()
            else:
                book_data["title"] = text

        # Extract page count and publication year
        page_info = soup.find("div", string=lambda t: t and "pages" in t.lower())
        if page_info:
            text = page_info.get_text(strip=True)
            # Parse "1280 pages • first pub 1960"
            import re

            pages_match = re.search(r"(\d+)\s+pages", text)
            if pages_match:
                book_data["pages"] = int(pages_match.group(1))

            year_match = re.search(r"first pub (\d{4})", text)
            if year_match:
                book_data["publication_year"] = int(year_match.group(1))

        # Extract cover image
        cover_img = soup.find("img", alt=lambda t: t and book_data.get("title", "") in t)
        if cover_img and "src" in cover_img.attrs:
            book_data["cover_url"] = cover_img["src"]

        # Extract description
        desc_heading = soup.find("h4", string="DESCRIPTION")
        if desc_heading:
            desc_text = desc_heading.find_next_sibling(string=True)
            if desc_text:
                book_data["description"] = desc_text.strip()

        # Extract average rating
        rating_elem = soup.find("div", string=lambda t: t and "based on" in str(t))
        if rating_elem:
            # Find the rating number (typically before "based on")
            rating_text = rating_elem.find_previous_sibling(string=True)
            if rating_text:
                try:
                    book_data["average_rating"] = float(rating_text.strip())
                except ValueError:
                    pass

            # Extract number of ratings
            import re

            ratings_match = re.search(r"([\d,]+)\s+reviews", rating_elem.get_text())
            if ratings_match:
                book_data["num_ratings"] = int(ratings_match.group(1).replace(",", ""))

        # Extract moods
        moods = []
        moods_section = soup.find("div", string="MOODS")
        if moods_section:
            mood_items = moods_section.find_next_siblings()
            for item in mood_items:
                text = item.get_text(strip=True)
                if ":" in text:
                    mood = text.split(":")[0].strip()
                    moods.append(mood)
        book_data["moods"] = moods

        # Extract pace
        pace_section = soup.find("div", string="Pace")
        if pace_section:
            # Look for highest percentage
            if "slow" in str(pace_section.parent).lower():
                book_data["pace"] = "slow"
            elif "fast" in str(pace_section.parent).lower():
                book_data["pace"] = "fast"
            else:
                book_data["pace"] = "medium"

        return book_data

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
        if not self.auth.is_authenticated():
            raise NotAuthenticatedError("Must be logged in to add books to TBR")

        # This would require capturing the actual endpoint
        # Placeholder for now
        raise NotImplementedError("add_to_tbr not yet implemented")

    async def mark_as_finished(
        self, book_id: str, rating: Optional[float] = None, review: Optional[str] = None
    ) -> bool:
        """
        Mark a book as finished.

        Args:
            book_id: Book UUID
            rating: Optional rating (0.25-5.0 in 0.25 increments)
            review: Optional review text

        Returns:
            True if successful

        Raises:
            NotAuthenticatedError: If not logged in
        """
        if not self.auth.is_authenticated():
            raise NotAuthenticatedError("Must be logged in to mark books as finished")

        # This would require capturing the actual endpoint
        # Placeholder for now
        raise NotImplementedError("mark_as_finished not yet implemented")
