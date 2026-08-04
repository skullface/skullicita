"""User-related data models."""

from typing import Optional
from pydantic import BaseModel, Field


class ReadingStats(BaseModel):
    """User reading statistics."""

    books_read: int = Field(default=0, description="Total books read")
    pages_read: int = Field(default=0, description="Total pages read")
    currently_reading: int = Field(default=0, description="Number of books currently reading")
    to_read: int = Field(default=0, description="Number of books in TBR")
    average_rating: Optional[float] = Field(None, description="Average rating given")

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "books_read": 142,
                "pages_read": 45230,
                "currently_reading": 3,
                "to_read": 87,
                "average_rating": 4.1,
            }
        }


class User(BaseModel):
    """Represents a StoryGraph user."""

    id: str = Field(..., description="User UUID")
    username: Optional[str] = Field(None, description="Username")
    email: Optional[str] = Field(None, description="Email address")
    stats: Optional[ReadingStats] = Field(None, description="Reading statistics")

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "id": "4f25f38b-c360-419f-bcbc-b2f53564b053",
                "username": "bookworm",
                "email": "user@example.com",
            }
        }
