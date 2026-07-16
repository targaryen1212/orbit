import type { CreateOrbitMemoryRequest } from "./types.js";

const DEFAULT_UPLOAD_TIMEOUT_MS = 90_000;

type JsonRequest = <T>(path: string, init: RequestInit) => Promise<T>;
type TimedFetch = (input: RequestInfo | URL, init: RequestInit, timeoutMs: number) => Promise<Response>;

export interface OrbitBookmarksApi {
  /** Save a protocol memory through Orbit's bookmark ingestion workflow. */
  createMemory(memory: CreateOrbitMemoryRequest): Promise<unknown>;
  /** Return canonical source URLs already stored by the authenticated user. */
  findExistingUrls(urls: string[]): Promise<Set<string>>;
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
  constructor(
    private readonly request: JsonRequest,
    private readonly fetch: TimedFetch,
    private readonly uploadTimeoutMs: number,
  ) {}

  async createMemory(memory: CreateOrbitMemoryRequest): Promise<unknown> {
    const media = localMedia(memory);
    const primaryMediaId = media ? await this.uploadMedia(media) : undefined;
    const sourceUrl = firstHttpUrl(memory.source.url, stringMetadata(memory.metadata, "sourcePageUrl"));
    const sourcePlatform = memory.source.platform?.trim() || host(sourceUrl) || "orbit";
    const searchableText = [memory.title, memory.summary, memory.note, memory.content?.text, memory.content?.caption]
      .filter((value): value is string => Boolean(value?.trim()))
      .join("\n")
      .slice(0, 20_000);

    return this.request("/bookmarks", {
      method: "POST",
      headers: { "idempotency-key": stringMetadata(memory.metadata, "idempotencyKey") || crypto.randomUUID() },
      body: JSON.stringify(withoutUndefined({
        sourcePlatform,
        sourcePermalinkUrl: sourceUrl,
        sourceOriginalSharedUrl: sourceUrl,
        sourceCanonicalUrl: sourceUrl,
        sourceHost: host(sourceUrl),
        displayTitle: memory.title || defaultTitle(memory),
        previewText: memory.summary || memory.content?.caption || memory.content?.text || memory.note,
        platformDisplayName: sourcePlatform,
        category: "bookmark",
        type: memory.source.type,
        mediaKind: mediaKind(memory),
        isTextOnly: ["text", "note", "quote"].includes(memory.source.type),
        primaryMediaId,
        tags: memory.tags?.slice(0, 12),
        details: {
          caption: memory.content?.caption,
          userNote: memory.note,
          searchableText: searchableText || undefined,
        },
      })),
    });
  }

  async findExistingUrls(urls: string[]): Promise<Set<string>> {
    const existing = new Set<string>();
    const uniqueUrls = [...new Set(urls)];
    for (let offset = 0; offset < uniqueUrls.length; offset += 400) {
      const response = await this.request<{ data: { existingUrls: string[] } }>("/bookmarks/existence", {
        method: "POST",
        body: JSON.stringify({ urls: uniqueUrls.slice(offset, offset + 400) }),
      });
      for (const url of response.data.existingUrls) existing.add(url);
    }
    return existing;
  }

  private async uploadMedia(media: LocalMedia): Promise<string> {
    const clientRequestId = crypto.randomUUID();
    const upload = await this.request<{ data: { mediaObjectId: string; uploadUrl: string } }>("/media/upload-url", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
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
      headers: { "content-type": media.blob.type || "application/octet-stream" },
      body: media.blob,
    }, this.uploadTimeoutMs);
    if (!put.ok) throw await responseError(put, "Orbit media upload failed");

    await this.request("/media/finalize", {
      method: "POST",
      headers: { "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ mediaObjectId: upload.data.mediaObjectId, slot: media.role, clientRequestId }),
    });
    return upload.data.mediaObjectId;
  }
}

interface LocalMedia {
  blob: Blob;
  role: "primary" | "voice_note" | "file" | "video";
}

function localMedia(memory: CreateOrbitMemoryRequest): LocalMedia | null {
  const raw = memory.source.raw;
  if (!raw) return null;
  const encoded = [raw.dataUrl, raw.fileData, raw.audioData].find((value): value is string =>
    typeof value === "string" && value.startsWith("data:"),
  );
  if (!encoded) return null;
  const blob = dataUrlToBlob(encoded);
  const role = memory.source.type === "audio" ? "voice_note" :
    memory.source.type === "video" ? "video" :
      memory.source.type === "file" ? "file" : "primary";
  return { blob, role };
}

function dataUrlToBlob(value: string): Blob {
  const comma = value.indexOf(",");
  if (comma < 0) throw new Error("Memory media data is invalid.");
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

function host(value?: string): string | undefined {
  try { return value ? new URL(value).hostname : undefined; } catch { return undefined; }
}

function stringMetadata(value: Record<string, unknown> | undefined, key: string): string | undefined {
  return typeof value?.[key] === "string" ? value[key] : undefined;
}

function mediaKind(memory: CreateOrbitMemoryRequest): string | undefined {
  return ["image", "audio", "video", "file"].includes(memory.source.type) ? memory.source.type : undefined;
}

function defaultTitle(memory: CreateOrbitMemoryRequest): string {
  return memory.source.type === "quote" ? "Saved quote" : `Saved ${memory.source.type}`;
}

function withoutUndefined<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
  return new Error(body.message || body.error || `${fallback} (${response.status})`);
}
