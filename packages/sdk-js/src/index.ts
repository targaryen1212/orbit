export { OrbitClient, normalizeOrbitBaseUrl } from "./client.js";
export type { OrbitClientConfig } from "./client.js";
export type { OrbitBookmarksApi } from "./bookmarks.js";
export {
  LocalOrbitStore,
  buildEvidenceChunks,
  isRedactedSource,
} from "./local-store.js";
export {
  cosineSimilarity,
  createDeterministicEmbeddingProvider,
  keywordScore,
  normalizeVector,
} from "./embeddings.js";
export type { OrbitEmbeddingProvider } from "./embeddings.js";
export type {
  CreateOrbitMemoryInput,
  CreateOrbitMemoryRequest,
  CreateOrbitQrAuthSessionInput,
  OrbitEmbedding,
  OrbitEntitySet,
  OrbitEvidenceChunk,
  OrbitEvidenceKind,
  OrbitEvidenceSearchInput,
  OrbitExtensionAuthRevokeResult,
  OrbitGeoPoint,
  OrbitAddress,
  OrbitId,
  OrbitMemoryObject,
  OrbitQrAuthClientInfo,
  OrbitQrAuthPollInput,
  OrbitQrAuthResult,
  OrbitQrAuthSession,
  OrbitQrAuthStatus,
  OrbitQrAuthToken,
  OrbitQrAuthUser,
  OrbitQrAuthWaitOptions,
  OrbitRelation,
  OrbitResource,
  OrbitSearchFilters,
  OrbitSearchHit,
  OrbitSource,
  OrbitSourceType,
  OrbitStore,
  OrbitTimestamp,
  OrbitUserMemory,
} from "./types.js";
