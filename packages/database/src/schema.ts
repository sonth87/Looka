export const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS persons (
  id TEXT PRIMARY KEY,
  employee_code TEXT,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS face_profiles (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  profile_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  model_family TEXT NOT NULL,
  model_version TEXT NOT NULL,
  preprocessing_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face_embeddings (
  id TEXT PRIMARY KEY,
  face_profile_id TEXT NOT NULL,
  vector_blob BLOB NOT NULL,
  dimension INTEGER NOT NULL,
  pose_yaw REAL NOT NULL,
  pose_pitch REAL NOT NULL,
  pose_roll REAL NOT NULL,
  quality_score REAL NOT NULL,
  model_family TEXT NOT NULL,
  model_version TEXT NOT NULL,
  preprocessing_version TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (face_profile_id) REFERENCES face_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS face_samples (
  id TEXT PRIMARY KEY,
  face_profile_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  image_path TEXT NOT NULL,
  quality_score REAL NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (face_profile_id) REFERENCES face_profiles(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  attendance_session_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'CHECK_IN',
  identity_score REAL NOT NULL,
  liveness_score REAL NOT NULL,
  quality_score REAL NOT NULL,
  model_version TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  device_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'PENDING',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (person_id) REFERENCES persons(id),
  FOREIGN KEY (attendance_session_id) REFERENCES attendance_sessions(id)
);

CREATE TABLE IF NOT EXISTS sync_queue (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS model_versions (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY',
  installed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  location_id TEXT,
  mode TEXT NOT NULL DEFAULT 'KIOSK',
  config_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  actor_id TEXT,
  timestamp INTEGER NOT NULL,
  metadata TEXT
);
`;
