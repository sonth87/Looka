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
  SESSION_REPORT_INVALID_PAYLOAD: 1002,
  // 2026-09-24 fix (confirmed audit finding): a kiosk device authenticates
  // itself, but nothing checked that a `sessionId` it posts a photo/video
  // for actually belongs to ITS OWN device+campaign — see
  // `PhotoService.addDevicePhoto`/`SessionVideoService.addDeviceVideo`.
  SESSION_DEVICE_MISMATCH: 1003,

  // PHOTO (2xxx)
  PHOTO_NOT_FOUND: 2000,
  PHOTO_INVALID_DATA_URL: 2001,
  PHOTO_UNSUPPORTED_MIME_TYPE: 2002,
  PHOTO_TOO_LARGE: 2003,
  PHOTO_STATUS_INVALID_PAYLOAD: 2004,
  PHOTO_LOCAL_TOKEN_INVALID: 2005,

  // FILE STORAGE / file-service integration (3xxx)
  FILE_STORAGE_NOT_READY: 3000,
  FILE_STORAGE_UPSTREAM_ERROR: 3001,

  // AUTH (4xxx)
  API_KEY_MISSING: 4000,
  API_KEY_INVALID: 4001,

  // DEVICE MANAGEMENT — campaigns/devices/CMS (5xxx)
  CAMPAIGN_NOT_FOUND: 5000,
  DEVICE_NOT_FOUND: 5001,
  DEVICE_NOT_REGISTERED: 5002,
  DEVICE_EXPIRED: 5003,
  DEVICE_ALREADY_ACTIVATED: 5004,
  DEVICE_SECRET_INVALID: 5005,
  INSTALLER_NOT_CONFIGURED: 5006,
  CAMPAIGN_HAS_DEPENDENCIES: 5007,
  DEVICE_REVOKED: 5008,
  CAMPAIGN_CODE_TAKEN: 5009,
  CAPTURE_ANGLE_PRESET_NOT_FOUND: 5010,
  CAPTURE_ANGLE_PRESET_CODE_TAKEN: 5011,
  CAMPAIGN_MEMBER_NOT_FOUND: 5012,
  DEVICE_HAS_NO_CAMPAIGN: 5013,
  DEVICE_FINGERPRINT_REVOKED: 5014,
  CAPTURE_CONFIGURATION_NOT_FOUND: 5015,
  CAMPAIGN_SUBJECT_IMPORT_NOT_FOUND: 5016,
  CAMPAIGN_SUBJECT_IMPORT_IN_USE: 5017,
  CAMPAIGN_SUBJECT_IMPORT_FILE_INVALID: 5018,
  CAMPAIGN_SUBJECT_NOT_FOUND: 5019,
  CAMPAIGN_KIOSK_ASSIGNMENT_CONFLICT: 5020,
  DEVICE_CAMPAIGN_MISMATCH: 5021,
  CAMPAIGN_MEMBER_GRANT_USER_NOT_FOUND: 5022,
  CAMPAIGN_SUBJECT_SYNC_NO_API_CONFIG: 5023,
  CAMPAIGN_SUBJECT_SYNC_NOT_FOUND: 5024,

  // VIDEO — kiosk video upload reporting (6xxx)
  VIDEO_NOT_FOUND: 6000,
  VIDEO_STATUS_INVALID_PAYLOAD: 6001,
  // The file-service copy is known-bad (FAILED/QUARANTINED) or has sat in a
  // non-terminal scan state so long it is presumed lost — see
  // `SessionVideoService.resolveViewContext`. Distinct from
  // `FILE_STORAGE_NOT_READY` (3000, "not there yet, try later" — retryable)
  // because this one never will be.
  VIDEO_PROCESSING_FAILED: 6002,
  // 2026-09-09 ("route kiosk video uploads through apps/api", mirroring the
  // photo pipeline's PHOTO_INVALID_DATA_URL/PHOTO_UNSUPPORTED_MIME_TYPE/
  // PHOTO_TOO_LARGE/PHOTO_LOCAL_TOKEN_INVALID — see PhotoService.decodeDataUrl/
  // issueLocalViewLink for the twin codes these mirror).
  VIDEO_INVALID_DATA_URL: 6003,
  VIDEO_UNSUPPORTED_MIME_TYPE: 6004,
  VIDEO_TOO_LARGE: 6005,
  VIDEO_LOCAL_TOKEN_INVALID: 6006,

  // STUDENT — "sinh viên đã chụp" gallery (7xxx)
  STUDENT_NOT_FOUND: 7000,

  // ATTEMPT_SUPERSEDED — post-save retake cleanup (8xxx)
  ATTEMPT_SUPERSEDED_INVALID_PAYLOAD: 8000,
};

export const ERROR_TYPE = {};
