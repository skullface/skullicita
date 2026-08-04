"""Book-related data models."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class Book(BaseModel):
    """Represents a book on StoryGraph."""

    id: str = Field(..., description="Unique book identifier (UUID)")
    title: str = Field(..., description="Book title")
    author: Optional[str] = Field(None, description="Primary author name")
    authors: list[str] = Field(default_factory=list, description="All authors")
    isbn: Optional[str] = Field(None, description="ISBN")
    pages: Optional[int] = Field(None, description="Number of pages")
    publication_year: Optional[int] = Field(None, description="Year first published")
    description: Optional[str] = Field(None, description="Book description")
    cover_url: Optional[str] = Field(None, description="URL to book cover image")

    # Community stats
    average_rating: Optional[float] = Field(None, description="Average community rating")
    num_ratings: Optional[int] = Field(None, description="Number of ratings")

    # Attributes
    genres: list[str] = Field(default_factory=list, description="Book genres")
    moods: list[str] = Field(default_factory=list, description="Book moods")
    pace: Optional[str] = Field(None, description="Reading pace (fast/medium/slow)")

    # User-specific
    user_rating: Optional[float] = Field(None, description="User's rating")
    user_status: Optional[str] = Field(None, description="Reading status")
    user_progress: Optional[int] = Field(None, description="User's reading progress")
    user_progress_type: Optional[str] = Field(None, description="Progress type (percent/pages)")
    start_date: Optional[datetime] = Field(None, description="Date started reading")
    finish_date: Optional[datetime] = Field(None, description="Date finished reading")

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "id": "8f869c7d-0abb-4eac-967f-68c1dffe2d65",
                "title": "The Rise and Fall of the Third Reich",
                "author": "William L. Shirer",
                "authors": ["William L. Shirer"],
                "pages": 1280,
                "publication_year": 1960,
                "average_rating": 4.29,
                "num_ratings": 3734,
                "moods": ["informative", "dark", "challenging"],
                "pace": "slow",
                "user_progress": 92,
                "user_progress_type": "percent",
                "user_status": "currently-reading",
            }
        }


class BookSearchResult(BaseModel):
    """Represents a book in search results."""

    id: str = Field(..., description="Unique book identifier (UUID)")
    title: str = Field(..., description="Book title")
    author: Optional[str] = Field(None, description="Primary author name")
    cover_url: Optional[str] = Field(None, description="URL to book cover image")
    publication_year: Optional[int] = Field(None, description="Year first published")
    average_rating: Optional[float] = Field(None, description="Average community rating")

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "id": "book-uuid-here",
                "title": "1984",
                "author": "George Orwell",
                "publication_year": 1949,
                "average_rating": 4.19,
            }
        }
