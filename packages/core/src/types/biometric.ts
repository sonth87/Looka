import { FacePose } from './face.js';

export interface FaceEmbedding {
  vector: Float32Array;
  dimension: number;
  modelFamily: string;
  modelVersion: string;
  preprocessingVersion: string;
  similarityMetric: 'cosine' | 'euclidean' | 'inner_product';
}

export type ProfileStatus = 'DRAFT' | 'ACTIVE' | 'DISABLED' | 'REPLACED';

export interface ProfileEmbeddingMetadata {
  id: string;
  taskType: string;
  pose: FacePose;
  qualityScore: number;
  createdAt: number;
}

export interface FaceProfile {
  id: string;
  personId: string;
  profileVersion: number;
  status: ProfileStatus;
  modelFamily: string;
  modelVersion: string;
  preprocessingVersion: string;
  embeddings: ProfileEmbeddingMetadata[];
  createdAt: number;
  updatedAt: number;
}

export interface Person {
  id: string;
  employeeCode?: string;
  displayName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  createdAt: number;
  updatedAt: number;
}

export interface RecognitionCandidate {
  personId: string;
  score: number;
  profileId: string;
}

export type RecognitionStatus =
  | 'MATCH'
  | 'UNKNOWN'
  | 'AMBIGUOUS'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'LOW_QUALITY'
  | 'LIVENESS_FAILED';

export interface RecognitionResult {
  status: RecognitionStatus;
  personId?: string;
  score?: number;
  candidates?: RecognitionCandidate[];
  modelVersion: string;
  durationMs: number;
}

export interface LivenessResult {
  isLive: boolean;
  score: number;
  status: 'LIVE' | 'SPOOF' | 'UNKNOWN' | 'FAILED';
  modelVersion: string;
  durationMs: number;
}

export interface AttendanceResult {
  status: 'RECORDED' | 'ALREADY_RECORDED' | 'REJECTED' | 'ERROR';
  attendanceId?: string;
  personId?: string;
  timestamp?: number;
  message?: string;
}
