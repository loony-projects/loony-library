// An error in how a command was invoked or configured (bad option, missing
// or wrong UPLOAD_BOOK_PATH, a bad book.json) - CLIs print just the message,
// no stack.
export class UsageError extends Error {}
