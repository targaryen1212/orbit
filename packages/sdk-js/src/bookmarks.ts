import type { CreateOrbitItemRequest, OrbitBookmarkSaveResult } from "./types.js";
import { orbitApiErrorFromResponse } from "./errors.js";

const DEFAULT_UPLOAD_TIMEOUT_MS = 90_000;

type JsonRequest = <T>(path: string, init: RequestInit) => Promise<T>;
type TimedFetch = (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => Promise<Response>;

export interface OrbitBookmarkCreateOptions {
  /**
   * Stable identity for this save so retries replay instead of duplicating.
   * URL captures derive one automatically from normalized content; captures
   * without a URL derive one from the request object's identity, which does
   * NOT survive a process restart or a re-built request object — pass an
   * explicit key whenever a retry may happen with a new object.
   */
  idempotencyKey?: string;
  signal?: AbortSignal;
}

export interface OrbitBookmarksApi {
  /** Save content through Orbit's bookmark ingestion workflow. */
  createItem(item: CreateOrbitItemRequest, options?: OrbitBookmarkCreateOptions): Promise<OrbitBookmarkSaveResult>;
  /** Return canonical source URLs already stored by the authenticated user. */
  findExistingUrls(urls: string[], options?: { signal?: AbortSignal }): Promise<Set<string>>;
}

export function createOrbitBookmarksApi(config: {
  request: JsonRequest;
  fetch: TimedFetch;
  uploadTimeoutMs?: number;
}): OrbitBookmarksApi {
  return new OrbitBookmarksClient(
    config.request,
    config.fetch,
    config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
  );
}

class OrbitBookmarksClient implements OrbitBookmarksApi {
  private readonly captureKeys = new WeakMap<CreateOrbitItemRequest, string>();

  constructor(
    private readonly request: JsonRequest,
    private readonly fetch: TimedFetch,
    private readonly uploadTimeoutMs: number,
  ) {}

  async createItem(item: CreateOrbitItemRequest, options: OrbitBookmarkCreateOptions = {}): Promise<OrbitBookmarkSaveResult> {
    const operationKey = options.idempotencyKey?.trim() || await this.operationKey(item);
    const media = localMedia(item);
    const primaryMediaId = media ? await this.uploadMedia(media, operationKey, options.signal) : undefined;
    const sourceUrl = firstHttpUrl(item.source.url, stringMetadata(item.metadata, "sourcePageUrl"));
    const sourcePlatform = item.source.platform?.trim() || host(sourceUrl) || "orbit";
    const searchableText = [item.title, item.summary, item.note, item.content?.text, item.content?.caption]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n")
      .slice(0, 20_000);

    return this.request<OrbitBookmarkSaveResult>("/bookmarks", {
      method: "POST",
      signal: options.signal,
      headers: { "idempotency-key": operationKey },
      body: JSON.stringify(withoutUndefined({
        sourcePlatform,
        sourcePermalinkUrl: sourceUrl,
        sourceOriginalSharedUrl: sourceUrl,
        sourceCanonicalUrl: sourceUrl,
        sourceHost: host(sourceUrl),
        displayTitle: item.title || defaultTitle(item),
        previewText: item.summary || item.content?.caption || item.content?.text || item.note,
        platformDisplayName: sourcePlatform,
        type: item.source.type,
        mediaKind: mediaKind(item),
        isTextOnly: ["text", "note", "quote"].includes(item.source.type),
        primaryMediaId,
        tags: item.tags?.slice(0, 12),
        details: {
          caption: item.content?.caption,
          userNote: item.note,
          searchableText: searchableText || undefined,
        },
      })),
    });
  }

  private async operationKey(item: CreateOrbitItemRequest): Promise<string> {
    const explicitKey = stringMetadata(item.metadata, "idempotencyKey")?.trim();
    if (explicitKey) return explicitKey;

    const sourceUrl = firstHttpUrl(item.source.url, stringMetadata(item.metadata, "sourcePageUrl"));
    if (sourceUrl) {
      const metadata = withoutKey(item.metadata, "idempotencyKey");
      if (metadata && typeof metadata.sourcePageUrl === "string" && /^https?:\/\//i.test(metadata.sourcePageUrl)) {
        metadata.sourcePageUrl = normalizeHttpUrl(metadata.sourcePageUrl);
      }
      const normalizedItem = {
        ...item,
        source: {
          ...item.source,
          url: normalizeHttpUrl(sourceUrl),
          // Capture time is observational metadata, not source identity. A
          // social sync rebuilt after a timeout must still replay the same
          // URL operation instead of producing a new key every run.
          capturedAt: undefined,
        },
        metadata,
      };
      return `orbit:url:${await sha256(stableJson(normalizedItem))}`;
    }

    const existing = this.captureKeys.get(item);
    if (existing) return existing;
    const captureKey = `orbit:capture:${crypto.randomUUID()}`;
    this.captureKeys.set(item, captureKey);
    return captureKey;
  }

  async findExistingUrls(urls: string[], options: { signal?: AbortSignal } = {}): Promise<Set<string>> {
    const existing = new Set<string>();
    const uniqueUrls = [...new Set(urls)];
    for (let offset = 0; offset < uniqueUrls.length; offset += 400) {
      const response = await this.request<{ data: { existingUrls: string[] } }>("/bookmarks/existence", {
        method: "POST",
        signal: options.signal,
        body: JSON.stringify({ urls: uniqueUrls.slice(offset, offset + 400) }),
      });
      for (const url of response.data.existingUrls) existing.add(url);
    }
    return existing;
  }

  private async uploadMedia(media: LocalMedia, operationKey: string, signal?: AbortSignal): Promise<string> {
    const clientRequestId = await stageKey(operationKey, "media");
    const upload = await this.request<{ data: { mediaObjectId: string; uploadUrl: string } }>("/media/upload-url", {
      method: "POST",
      signal,
      headers: { "idempotency-key": await stageKey(operationKey, "upload") },
      body: JSON.stringify({
        role: media.role,
        mimeType: media.blob.type || "application/octet-stream",
        sizeBytes: media.blob.size,
        visibility: "private",
        clientRequestId,
      }),
    });
    const put = await this.fetch(upload.data.uploadUrl, {
      method: "PUT",
      signal,
      headers: { "content-type": media.blob.type || "application/octet-stream" },
      body: media.blob,
    }, this.uploadTimeoutMs);
    if (!put.ok) throw await orbitApiErrorFromResponse(put, "Orbit media upload failed");

    await this.request("/media/finalize", {
      method: "POST",
      signal,
      headers: { "idempotency-key": await stageKey(operationKey, "finalize") },
      body: JSON.stringify({ mediaObjectId: upload.data.mediaObjectId, slot: media.role, clientRequestId }),
    });
    return upload.data.mediaObjectId;
  }
}

interface LocalMedia {
  blob: Blob;
  role: "primary" | "voice_note" | "file" | "video";
}

function localMedia(item: CreateOrbitItemRequest): LocalMedia | null {
  const raw = item.source.raw;
  if (!raw) return null;
  const encoded = [raw.dataUrl, raw.fileData, raw.audioData].find((value): value is string =>
    typeof value === "string" && value.startsWith("data:"),
  );
  if (!encoded) return null;
  const blob = dataUrlToBlob(encoded);
  const role = item.source.type === "audio" ? "voice_note" :
    item.source.type === "video" ? "video" :
      item.source.type === "file" ? "file" : "primary";
  return { blob, role };
}

function dataUrlToBlob(value: string): Blob {
  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("Saved media data is invalid.");
  const header = value.slice(5, comma);
  const mimeType = header.split(";")[0] || "application/octet-stream";
  const encoded = value.slice(comma + 1);
  const binary = header.includes(";base64") ? atob(encoded) : decodeURIComponent(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType });
}

function firstHttpUrl(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value && /^https?:\/\//i.test(value));
}

function normalizeHttpUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );
  url.search = "";
  for (const [key, itemValue] of entries) url.searchParams.append(key, itemValue);
  return url.toString();
}

function withoutKey(value: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const copy = { ...value };
  delete copy[key];
  return Object.keys(copy).length > 0 ? copy : undefined;
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, itemValue]) => itemValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, itemValue]) => [key, sortJson(itemValue)]),
  );
}

async function stageKey(operationKey: string, stage: string): Promise<string> {
  return `orbit:${stage}:${await sha256(operationKey)}`;
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function host(value?: string): string | undefined {
  try { return value ? new URL(value).hostname : undefined; } catch { return undefined; }
}

function stringMetadata(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] : undefined;
}

function mediaKind(item: CreateOrbitItemRequest): string | undefined {
  return ["image", "audio", "video", "file"].includes(item.source.type) ? item.source.type : undefined;
}

function defaultTitle(item: CreateOrbitItemRequest): string {
  return item.source.type === "quote" ? "Saved quote" : `Saved ${item.source.type}`;
}

function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, withoutUndefined(entryValue)]),
    ) as T;
  }
  return value;
}
