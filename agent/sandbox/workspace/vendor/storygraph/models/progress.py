"""Reading progress data models."""

from datetime import datetime
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class ProgressType(str, Enum):
    """Type of progress tracking."""

    PERCENT = "percent"
    PAGES = "pages"


class ReadingProgress(BaseModel):
    """Represents reading progress for a book."""

    book_id: str = Field(..., description="Book UUID")
    progress_type: ProgressType = Field(
        default=ProgressType.PERCENT, description="Type of progress tracking"
    )
    progress: int = Field(..., description="Progress value (0-100 for percent, or page number)")
    note: Optional[str] = Field(None, description="Optional note about this update")
    timestamp: datetime = Field(default_factory=datetime.now, description="When progress was updated")

    @field_validator("progress")
    @classmethod
    def validate_progress(cls, v: int, info: any) -> int:
        """Validate progress value based on type."""
        progress_type = info.data.get("progress_type", ProgressType.PERCENT)

        if progress_type == ProgressType.PERCENT:
            if not 0 <= v <= 100:
                raise ValueError("Progress percentage must be between 0 and 100")
        elif progress_type == ProgressType.PAGES:
            if v < 0:
                raise ValueError("Page number must be non-negative")

        return v

    class Config:
        """Pydantic configuration."""

        json_schema_extra = {
            "example": {
                "book_id": "8f869c7d-0abb-4eac-967f-68c1dffe2d65",
                "progress": 92,
                "progress_type": "percent",
                "note": "Great chapter on Operation Barbarossa",
            }
        }
