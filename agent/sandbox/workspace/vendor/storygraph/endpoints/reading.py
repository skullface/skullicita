"""Reading progress endpoint module."""

from typing import Any, Optional
import httpx
from bs4 import BeautifulSoup

from storygraph.models.book import Book
from storygraph.models.progress import ReadingProgress, ProgressType
from storygraph.exceptions import NotAuthenticatedError, InvalidProgressError, ParseError


class ReadingEndpoint:
    """Handles reading progress and currently reading books."""

    def __init__(self, client: Any, base_url: str, auth_manager: Any):
        """
        Initialize reading endpoint.

        Args:
            client: Async HTTP client instance
            base_url: Base URL for StoryGraph
            auth_manager: Authentication manager instance
        """
        self.client = client
        self.base_url = base_url
        self.auth = auth_manager

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
        if not self.auth.is_authenticated():
            raise NotAuthenticatedError("Must be logged in to update progress")

        # Validate progress using Pydantic model
        try:
            progress_obj = ReadingProgress(
                book_id=book_id,
                progress=progress,
                progress_type=progress_type,
                note=note,
            )
        except ValueError as e:
            raise InvalidProgressError(str(e)) from e

        csrf_token = self.auth.get_csrf_token()
        if not csrf_token:
            raise NotAuthenticatedError("No CSRF token available")

        # Prepare request data in the format StoryGraph expects
        # Based on actual form submission captured from browser
        data = {
            "return_to_home": "true",
            "book_id": book_id,
            "read_status[progress_minutes]": "",
        }

        if progress_type == ProgressType.PERCENT:
            data["read_status[progress_type]"] = "percentage"
            data["read_status[progress_number]"] = ""
            data["read_status[last_reached_percent]"] = str(progress)
            # Note: We'd need book page count to calculate last_reached_pages accurately
            # For now, leaving it out - StoryGraph seems to handle it
        else:
            data["read_status[progress_type]"] = "pages"
            data["read_status[progress_number]"] = str(progress)
            data["read_status[last_reached_percent]"] = ""

        if note:
            data["read_status[note]"] = note

        # Make the request
        try:
            response = await self.client.post(
                f"{self.base_url}/update-progress",
                data=data,
                headers={
                    "x-csrf-token": csrf_token,
                    "x-requested-with": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Accept": "text/javascript, application/javascript, */*; q=0.01",
                },
            )

            response.raise_for_status()
            return response.status_code == 200

        except httpx.HTTPError as e:
            raise InvalidProgressError(f"Error updating progress: {e}") from e

    async def get_currently_reading(self) -> list[Book]:
        """
        Get list of currently reading books.

        Returns:
            List of Book objects

        Raises:
            NotAuthenticatedError: If not logged in
            ParseError: If unable to parse response
        """
        if not self.auth.is_authenticated():
            raise NotAuthenticatedError("Must be logged in to get currently reading books")

        try:
            response = await self.client.get(self.base_url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # Find the "Current Reads" section
            books = []
            # Find heading - it might have extra whitespace
            current_reads_heading = soup.find("h2", string=lambda t: t and "Current Reads" in str(t))
            if not current_reads_heading:
                # Try alternate approach - find by text content
                all_h2 = soup.find_all("h2")
                for h2 in all_h2:
                    if "Current Reads" in h2.get_text():
                        current_reads_heading = h2
                        break

            if current_reads_heading:
                # Find book elements in this section
                section = current_reads_heading.find_parent()
                if section:
                    # Look for book containers (divs with class 'flex mb-6')
                    # Each container has the book info and progress
                    book_containers = section.find_all("div", class_="flex mb-6")

                    for container in book_containers:
                        # Find the book link with book-page-link class
                        book_link = container.find("a", class_="book-page-link")
                        if not book_link:
                            # Fallback to any link with /books/
                            book_link = container.find("a", href=lambda h: h and "/books/" in h)
                        if not book_link:
                            continue

                        href = book_link.get("href", "")
                        if "/books/" not in href:
                            continue

                        book_id = href.split("/books/")[1].split("?")[0]

                        # Extract title from img alt
                        img = book_link.find("img")
                        title = None
                        if img:
                            title = img.get("alt", "")
                            # Remove author from title if present (img alt includes "by Author")
                            if " by " in title:
                                title = title.split(" by ")[0]

                        # If no alt text, look for title link text in the container
                        if not title:
                            title_link = container.find("a", class_="standard-link")
                            if title_link:
                                title = title_link.get_text(strip=True)

                        if not title or not book_id:
                            continue

                        # Extract author from the p tag with specific classes
                        author = None
                        author_p = container.find("p", class_=lambda c: c and "text-darkerGrey" in str(c) and "text-[13px]" in str(c))
                        if author_p:
                            author = author_p.get_text(strip=True)

                        # Look for progress indicator - it's in a span with text-white class
                        user_progress = None
                        progress_span = container.find("span", class_=lambda c: c and "text-white" in str(c))
                        if progress_span:
                            try:
                                progress_text = progress_span.get_text(strip=True)
                                user_progress = int(progress_text.replace("%", ""))
                            except (ValueError, AttributeError):
                                pass

                        book_data = {
                            "id": book_id,
                            "title": title,
                            "author": author,
                            "user_status": "currently-reading",
                            "user_progress": user_progress,
                            "user_progress_type": "percent" if user_progress else None,
                        }

                        books.append(Book(**book_data))

            return books

        except httpx.HTTPError as e:
            raise ParseError(f"Error fetching currently reading books: {e}") from e

    async def get_to_read_pile(self) -> list[Book]:
        """
        Get list of books in To-Read pile.

        Returns:
            List of Book objects

        Raises:
            NotAuthenticatedError: If not logged in
            ParseError: If unable to parse response
        """
        if not self.auth.is_authenticated():
            raise NotAuthenticatedError("Must be logged in to get TBR pile")

        try:
            response = await self.client.get(self.base_url)
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # Find the "To-Read Pile" section
            books = []
            # Find heading using text content (h2 contains an <a> tag)
            tbr_heading = None
            all_h2 = soup.find_all("h2")
            for h2 in all_h2:
                if "To-Read Pile" in h2.get_text():
                    tbr_heading = h2
                    break

            if tbr_heading:
                section = tbr_heading.find_parent()
                if section:
                    # Find only book links (with book-page-link class to avoid duplicate links)
                    book_links = section.find_all("a", class_="book-page-link")
                    seen_ids = set()

                    for link in book_links:
                        href = link.get("href", "")
                        if "/books/" not in href:
                            continue

                        book_id = href.split("/books/")[1].split("?")[0]

                        # Skip duplicates
                        if book_id in seen_ids:
                            continue
                        seen_ids.add(book_id)

                        # Extract title and author from img alt
                        img = link.find("img")
                        title = None
                        author = None
                        if img:
                            alt_text = img.get("alt", "")
                            if " by " in alt_text:
                                parts = alt_text.split(" by ", 1)
                                title = parts[0]
                                author = parts[1]
                            else:
                                title = alt_text

                        if not title:
                            title = link.get_text(strip=True)

                        if title and book_id:
                            book_data = {
                                "id": book_id,
                                "title": title,
                                "author": author,
                                "user_status": "to-read",
                            }
                            books.append(Book(**book_data))

            return books

        except httpx.HTTPError as e:
            raise ParseError(f"Error fetching TBR pile: {e}") from e
