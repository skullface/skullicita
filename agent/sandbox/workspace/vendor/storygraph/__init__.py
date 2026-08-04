"""
StoryGraph API Wrapper

A Python wrapper for The StoryGraph's web interface.
"""

from storygraph.client import StoryGraphClient
from storygraph.exceptions import (
    StoryGraphError,
    AuthenticationError,
    NotAuthenticatedError,
    RateLimitError,
)

__version__ = "0.1.0"
__all__ = [
    "StoryGraphClient",
    "StoryGraphError",
    "AuthenticationError",
    "NotAuthenticatedError",
    "RateLimitError",
]
