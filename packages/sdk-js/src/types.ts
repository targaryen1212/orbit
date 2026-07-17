export type OrbitId = string;
export type OrbitTimestamp = string;

export type OrbitSourceType =
  | "url"
  | "text"
  | "image"
  | "audio"
  | "video"
  | "file"
  | "note"
  | "quote"
  | "event";

export type OrbitPrivacyScope = "private" | "shared" | "public";
export type OrbitMemoryStatus = "pending" | "processing" | "completed" | "degraded" | "failed";

export interface OrbitSource {
  type: OrbitSourceType;
  url?: string;
  text?: string;
  mimeType?: string;
  platform?: string;
  capturedAt?: OrbitTimestamp;
  raw?: Record<string, unknown>;
}

export interface OrbitEntitySet {
  people?: string[];
  organizations?: string[];
  places?: string[];
  topics?: string[];
  [key: string]: string[] | undefined;
}

export interface OrbitGeoPoint {
  latitude: number;
  longitude: number;
  precision?: "exact" | "approximate" | "city" | "region" | "unknown";
  source?: string;
}

export interface OrbitAddress {
  label?: string;
  street?: string;
  locality?: string;
  region?: string;
  postalCode?: string;
  country?: string;
  countryCode?: string;
}

export interface OrbitResource {
  id?: OrbitId;
  name: string;
  type: string;
  searchQuery?: string;
  url?: string;
  geo?: OrbitGeoPoint;
  address?: OrbitAddress;
  metadata?: Record<string, unknown>;
}

export interface OrbitMemoryContent {
  text?: string;
  caption?: string;
  transcript?: string;
}

export interface OrbitMemoryObject {
  schemaVersion: "orbit.memory.v0";
  id: OrbitId;
  ownerId: OrbitId;
  title?: string | null;
  summary?: string | null;
  note?: string | null;
  source: OrbitSource;
  content?: OrbitMemoryContent;
  tags?: string[];
  entities?: OrbitEntitySet;
  resources?: OrbitResource[];
  privacy?: {
    scope: OrbitPrivacyScope;
    redaction?: string[];
  };
  status?: OrbitMemoryStatus;
  metadata?: Record<string, unknown>;
  createdAt: OrbitTimestamp;
  updatedAt?: OrbitTimestamp;
}

export type OrbitEvidenceKind =
  | "summary"
  | "note"
  | "caption"
  | "transcript"
  | "body"
  | "resource"
  | "entity"
  | "location"
  | "event"
  | "custom";

export interface OrbitEmbedding {
  model: string;
  dimensions: number;
  vector: number[];
  normalized?: boolean;
}

export interface OrbitEvidenceChunk {
  schemaVersion: "orbit.evidence.v0";
  id: OrbitId;
  ownerId: OrbitId;
  memoryId: OrbitId;
  kind: OrbitEvidenceKind;
  text: string;
  sourceFields: string[];
  embedding?: OrbitEmbedding;
  category?: string;
  tags?: string[];
  entities?: OrbitEntitySet;
  resources?: OrbitResource[];
  createdAt?: OrbitTimestamp;
  memoryCreatedAt?: OrbitTimestamp;
  metadata?: Record<string, unknown>;
}

export interface OrbitRelation {
  schemaVersion: "orbit.relation.v0";
  id: OrbitId;
  ownerId: OrbitId;
  fromMemoryId: OrbitId;
  toMemoryId: OrbitId;
  relationType: "semantic" | "entity" | "temporal" | "coactivation" | "manual" | "mixed";
  strength: number;
  signals: {
    semantic?: number;
    entityOverlap?: number;
    temporal?: number;
    coActivation?: number;
    [key: string]: number | undefined;
  };
  createdAt?: OrbitTimestamp;
  updatedAt?: OrbitTimestamp;
  metadata?: Record<string, unknown>;
}

export interface OrbitUserMemory {
  schemaVersion: "orbit.user_memory.v0";
  id: OrbitId;
  ownerId: OrbitId;
  content: string;
  source: "explicit" | "conversation" | "import" | "inference";
  confidence?: number;
  status?: "active" | "archived" | "deleted";
  createdAt: OrbitTimestamp;
  updatedAt?: OrbitTimestamp;
  metadata?: Record<string, unknown>;
}

export interface CreateOrbitMemoryInput {
  ownerId: OrbitId;
  source: OrbitSource;
  title?: string | null;
  summary?: string | null;
  note?: string | null;
  content?: OrbitMemoryContent;
  tags?: string[];
  entities?: OrbitEntitySet;
  resources?: OrbitResource[];
  privacy?: OrbitMemoryObject["privacy"];
  status?: OrbitMemoryStatus;
  metadata?: Record<string, unknown>;
  id?: OrbitId;
  createdAt?: OrbitTimestamp;
}

export type CreateOrbitMemoryRequest = Omit<CreateOrbitMemoryInput, "ownerId" | "id" | "createdAt">;

export interface OrbitSearchFilters {
  memoryIds?: OrbitId[];
  category?: string;
  tags?: string[];
  sourceTypes?: OrbitSourceType[];
  entities?: Partial<OrbitEntitySet>;
  createdAfter?: OrbitTimestamp;
  createdBefore?: OrbitTimestamp;
}

export interface OrbitEvidenceSearchInput {
  ownerId: OrbitId;
  query: string;
  filters?: OrbitSearchFilters;
  limit?: number;
  includeVectors?: boolean;
}

export interface OrbitSearchHit<T> {
  item: T;
  score: number;
  semanticScore?: number;
  keywordScore?: number;
}

export type OrbitQrAuthStatus =
  | "pending"
  | "authorized"
  | "expired"
  | "cancelled"
  | "consumed";

export interface OrbitQrAuthClientInfo {
  type?: string;
  name?: string;
  extensionId?: string;
  platform?: string;
}

export interface CreateOrbitQrAuthSessionInput {
  client?: OrbitQrAuthClientInfo;
  scopes?: string[];
}

export interface OrbitQrAuthSession {
  schemaVersion: "orbit.auth.qr_session.v0";
  sessionId: string;
  code: string;
  status: OrbitQrAuthStatus;
  verificationUri: string;
  verificationUriComplete: string;
  qrImageUrl?: string;
  expiresAt: OrbitTimestamp;
  pollAfterMs?: number;
}

export interface OrbitQrAuthUser {
  uid: string;
  email?: string;
  displayName?: string;
  photoURL?: string;
}

export interface OrbitQrAuthToken {
  tokenType: "firebase_custom_token" | "bearer";
  customToken?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: OrbitTimestamp;
}

export interface OrbitQrAuthResult {
  schemaVersion: "orbit.auth.qr_result.v0";
  sessionId: string;
  status: OrbitQrAuthStatus;
  user?: OrbitQrAuthUser | null;
  token?: OrbitQrAuthToken;
}

export interface OrbitExtensionAuthRevokeResult {
  status: "revoked";
}

export interface OrbitQrAuthPollInput {
  sessionId: string;
  code: string;
}

export interface OrbitQrAuthWaitOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface OrbitStore {
  putMemory(input: CreateOrbitMemoryInput | OrbitMemoryObject): Promise<OrbitMemoryObject>;
  getMemory(memoryId: OrbitId, ownerId: OrbitId): Promise<OrbitMemoryObject | null>;
  listMemories(ownerId: OrbitId, options?: { limit?: number }): Promise<OrbitMemoryObject[]>;
  indexMemory(memoryId: OrbitId, ownerId: OrbitId): Promise<OrbitEvidenceChunk[]>;
  putEvidenceChunks(chunks: OrbitEvidenceChunk[]): Promise<OrbitEvidenceChunk[]>;
  searchEvidence(input: OrbitEvidenceSearchInput): Promise<Array<OrbitSearchHit<OrbitEvidenceChunk>>>;
  upsertUserMemory(input: Omit<OrbitUserMemory, "schemaVersion" | "id" | "createdAt"> & { id?: OrbitId; createdAt?: OrbitTimestamp }): Promise<OrbitUserMemory>;
  listUserMemories(ownerId: OrbitId, options?: { limit?: number }): Promise<OrbitUserMemory[]>;
  deleteUserMemory(memoryId: OrbitId, ownerId: OrbitId): Promise<boolean>;
}
