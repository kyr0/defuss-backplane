/** VERIFIED: Public fault contract shared by the SDK and both transports. */
export const statuses = {
  INVALID_ARGUMENT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  ALREADY_EXISTS: 409,
  REVISION_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  DSON_REQUIRED: 422,
  BUSY: 503,
  UNAVAILABLE: 503,
  STORAGE_ERROR: 500,
  COMMIT_UNCERTAIN: 500,
  INTERNAL_ERROR: 500,
} as const;
export type ErrorCode = keyof typeof statuses;

export class BackplaneError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    status: number = statuses[code],
  ) {
    super(message);
    this.name = "BackplaneError";
    this.status = status;
  }
}
