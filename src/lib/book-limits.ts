// Shared by the browser and server. AI still receives only one bounded chapter.
export const MAX_BOOK_MB = 100;
export const MAX_BOOK_BYTES = MAX_BOOK_MB * 1024 * 1024;
export const MAX_BOOK_TEXT = 10_000_000;
export const MAX_BOOK_CHAPTERS = 2000;
export const MAX_ARCHIVE_TEXT_BYTES = 64 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = MAX_BOOK_BYTES + MAX_BOOK_TEXT * 4 + 1024 * 1024;
