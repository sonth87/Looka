/**
 * Domain error codes used by CustomException. Grouped by module, each with its
 * own numeric range so codes stay unique and it's obvious where an error came
 * from just by looking at the number. Extend a range as new modules are added.
 */
export const ERROR_CODE = {
  VALIDATION_ERROR: 1,
  PARAM_ERROR: 1, // Alias for VALIDATION_ERROR
  RECORD_NOT_FOUND: 404, // Alias for NOT_FOUND

  // HTTP
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  BAD_REQUEST: 400,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  UNPROCESSABLE_ENTITY: 422,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
  INTERNAL_SERVER_ERROR: 500,
  BAD_GATEWAY: 502,
  NOT_IMPLEMENTED: 501,

  // CAPTURE SESSION (1xxx)
  SESSION_NOT_FOUND: 1000,
  SESSION_ALREADY_COMPLETED: 1001,

  // PHOTO (2xxx)
  PHOTO_NOT_FOUND: 2000,
  PHOTO_INVALID_DATA_URL: 2001,
  PHOTO_UNSUPPORTED_MIME_TYPE: 2002,
  PHOTO_TOO_LARGE: 2003,

  // FILE STORAGE / file-service integration (3xxx)
  FILE_STORAGE_NOT_READY: 3000,
  FILE_STORAGE_UPSTREAM_ERROR: 3001,

  // AUTH (4xxx)
  API_KEY_MISSING: 4000,
  API_KEY_INVALID: 4001,
};

export const ERROR_TYPE = {};
