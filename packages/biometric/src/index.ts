export { l2Normalize, dotProduct, cosineSimilarity, euclideanDistance } from './vectorMath.js';
export { MockEmbeddingExtractor } from './MockEmbeddingExtractor.js';
export { ProfileBuilder } from './ProfileBuilder.js';
export { EmbeddingServerClient, EmbeddingServerError } from './EmbeddingServerClient.js';
export type {
  EmbeddingServerConfig,
  EnrollFaceResult,
  EnrolledFace,
  ListFacesResult,
  DeleteFacesResult,
  HealthResult,
  SearchMatch,
  SearchFaceResult,
  EnrollFaceError,
  EmbeddingClientError,
} from './EmbeddingServerClient.js';
