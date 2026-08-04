"""API endpoint modules."""

from storygraph.endpoints.books import BooksEndpoint
from storygraph.endpoints.reading import ReadingEndpoint
from storygraph.endpoints.search import SearchEndpoint

__all__ = ["BooksEndpoint", "ReadingEndpoint", "SearchEndpoint"]
