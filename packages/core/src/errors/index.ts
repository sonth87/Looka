export type ErrorCategory =
  | 'CAMERA'
  | 'CV_ENGINE'
  | 'WORKFLOW'
  | 'BIOMETRIC'
  | 'DATABASE'
  | 'STORAGE'
  | 'NETWORK'
  | 'SECURITY'
  | 'SYSTEM';

export class FacePlatformError extends Error {
  public readonly code: string;
  public readonly category: ErrorCategory;
  public readonly isUserCorrectable: boolean;
  public readonly timestamp: number;
  public readonly details?: Record<string, any>;

  constructor(
    code: string,
    message: string,
    category: ErrorCategory,
    isUserCorrectable = false,
    details?: Record<string, any>
  ) {
    super(message);
    this.name = 'FacePlatformError';
    this.code = code;
    this.category = category;
    this.isUserCorrectable = isUserCorrectable;
    this.timestamp = Date.now();
    this.details = details;
    Object.setPrototypeOf(this, FacePlatformError.prototype);
  }

  public toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      category: this.category,
      isUserCorrectable: this.isUserCorrectable,
      timestamp: this.timestamp,
      details: this.details,
    };
  }
}

export const ERROR_CODES = {
  // Camera
  CAMERA_UNAVAILABLE: 'CAMERA_UNAVAILABLE',
  CAMERA_PERMISSION_DENIED: 'CAMERA_PERMISSION_DENIED',
  CAMERA_DISCONNECTED: 'CAMERA_DISCONNECTED',
  CAMERA_INIT_FAILED: 'CAMERA_INIT_FAILED',

  // CV Engine
  CV_MODEL_NOT_FOUND: 'CV_MODEL_NOT_FOUND',
  CV_MODEL_INIT_FAILED: 'CV_MODEL_INIT_FAILED',
  CV_INFERENCE_FAILED: 'CV_INFERENCE_FAILED',

  // Workflow
  NO_FACE_DETECTED: 'NO_FACE_DETECTED',
  MULTIPLE_FACES_DETECTED: 'MULTIPLE_FACES_DETECTED',
  QUALITY_CHECK_FAILED: 'QUALITY_CHECK_FAILED',
  STEP_TIMEOUT: 'STEP_TIMEOUT',
  SESSION_ALREADY_ACTIVE: 'SESSION_ALREADY_ACTIVE',

  // Biometric / Recognition
  EMBEDDING_FAILED: 'EMBEDDING_FAILED',
  MODEL_INCOMPATIBLE: 'MODEL_INCOMPATIBLE',
  UNKNOWN_IDENTITY: 'UNKNOWN_IDENTITY',
  AMBIGUOUS_IDENTITY: 'AMBIGUOUS_IDENTITY',
  LIVENESS_FAILED: 'LIVENESS_FAILED',

  // Database / Storage
  DB_TRANSACTION_FAILED: 'DB_TRANSACTION_FAILED',
  DB_DRIVER_UNAVAILABLE: 'DB_DRIVER_UNAVAILABLE',
  DB_NOT_READY: 'DB_NOT_READY',
  DB_MIGRATION_FAILED: 'DB_MIGRATION_FAILED',
  STORAGE_FULL: 'STORAGE_FULL',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',

  // Upload / sync to file-service
  UPLOAD_FAILED: 'UPLOAD_FAILED',
  UPLOAD_INCOMPLETE: 'UPLOAD_INCOMPLETE',
  FILE_QUARANTINED: 'FILE_QUARANTINED',
  SCAN_TIMEOUT: 'SCAN_TIMEOUT',
} as const;
