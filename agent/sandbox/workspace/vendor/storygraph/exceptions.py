"""Custom exceptions for the StoryGraph API wrapper."""


class StoryGraphError(Exception):
    """Base exception for all StoryGraph API errors."""

    pass


class AuthenticationError(StoryGraphError):
    """Raised when authentication fails."""

    pass


class NotAuthenticatedError(StoryGraphError):
    """Raised when an authenticated request is made without being logged in."""

    pass


class RateLimitError(StoryGraphError):
    """Raised when rate limit is exceeded."""

    pass


class BookNotFoundError(StoryGraphError):
    """Raised when a book is not found."""

    pass


class InvalidProgressError(StoryGraphError):
    """Raised when invalid progress data is provided."""

    pass


class ParseError(StoryGraphError):
    """Raised when unable to parse HTML response."""

    pass
