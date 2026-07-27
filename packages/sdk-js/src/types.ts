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
export type OrbitItemStatus = "pending" | "processing" | "completed" | "degraded" | "failed";

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

export interface OrbitItemContent {
  text?: string;
  caption?: string;
  transcript?: string;
}

export interface OrbitItem {
  schemaVersion: "orbit.item.v0";
  id: OrbitId;
  ownerId: OrbitId;
  title?: string | null;
  summary?: string | null;
  note?: string | null;
  source: OrbitSource;
  content?: OrbitItemContent;
  tags?: string[];
  entities?: OrbitEntitySet;
  resources?: OrbitResource[];
  privacy?: {
    scope: OrbitPrivacyScope;
    redaction?: string[];
  };
  status?: OrbitItemStatus;
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

export interface OrbitEvidenceChunk {
  schemaVersion: "orbit.evidence.v0";
  id: OrbitId;
  ownerId: OrbitId;
  itemId: OrbitId;
  kind: OrbitEvidenceKind;
  text: string;
  sourceFields: string[];
  category?: string;
  tags?: string[];
  entities?: OrbitEntitySet;
  resources?: OrbitResource[];
  createdAt?: OrbitTimestamp;
  itemCreatedAt?: OrbitTimestamp;
  metadata?: Record<string, unknown>;
}

export interface OrbitRelation {
  schemaVersion: "orbit.relation.v0";
  id: OrbitId;
  ownerId: OrbitId;
  fromItemId: OrbitId;
  toItemId: OrbitId;
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

export interface OrbitUserFact {
  schemaVersion: "orbit.user_fact.v0";
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

export interface CreateOrbitItemInput {
  ownerId: OrbitId;
  source: OrbitSource;
  title?: string | null;
  summary?: string | null;
  note?: string | null;
  content?: OrbitItemContent;
  tags?: string[];
  entities?: OrbitEntitySet;
  resources?: OrbitResource[];
  privacy?: OrbitItem["privacy"];
  status?: OrbitItemStatus;
  metadata?: Record<string, unknown>;
  id?: OrbitId;
  createdAt?: OrbitTimestamp;
}

export type CreateOrbitItemRequest = Omit<CreateOrbitItemInput, "ownerId" | "id" | "createdAt">;

export interface UpdateOrbitItemRequest {
  title?: string | null;
  summary?: string | null;
  note?: string | null;
  tags?: string[];
  privacy?: OrbitItem["privacy"];
  metadata?: Record<string, unknown>;
}

export interface OrbitListItemsResponse {
  items: OrbitItem[];
  nextCursor?: string | null;
}

export interface OrbitListUserFactsResponse {
  facts: OrbitUserFact[];
  nextCursor?: string | null;
}

/**
 * Response envelope from the bookmark ingestion route. The route is served by
 * the private Orbb backend; only the fields listed here are contractual.
 */
export interface OrbitBookmarkSaveResult {
  data?: {
    id?: string;
    bookmarkId?: string;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface OrbitSearchFilters {
  itemIds?: OrbitId[];
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
}

export interface OrbitSearchHit<T> {
  item: T;
  score: number;
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
  putItem(input: CreateOrbitItemInput | OrbitItem): Promise<OrbitItem>;
  getItem(itemId: OrbitId, ownerId: OrbitId): Promise<OrbitItem | null>;
  listItems(ownerId: OrbitId, options?: { limit?: number }): Promise<OrbitItem[]>;
  updateItem(itemId: OrbitId, ownerId: OrbitId, patch: UpdateOrbitItemRequest): Promise<OrbitItem | null>;
  deleteItem(itemId: OrbitId, ownerId: OrbitId): Promise<boolean>;
  indexItem(itemId: OrbitId, ownerId: OrbitId): Promise<OrbitEvidenceChunk[]>;
  putEvidenceChunks(chunks: OrbitEvidenceChunk[]): Promise<OrbitEvidenceChunk[]>;
  searchEvidence(input: OrbitEvidenceSearchInput): Promise<Array<OrbitSearchHit<OrbitEvidenceChunk>>>;
  upsertUserFact(input: Omit<OrbitUserFact, "schemaVersion" | "id" | "createdAt"> & { id?: OrbitId; createdAt?: OrbitTimestamp }): Promise<OrbitUserFact>;
  listUserFacts(ownerId: OrbitId, options?: { limit?: number }): Promise<OrbitUserFact[]>;
  deleteUserFact(factId: OrbitId, ownerId: OrbitId): Promise<boolean>;
}
