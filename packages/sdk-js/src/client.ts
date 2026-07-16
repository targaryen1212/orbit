import type {
  CreateOrbitMemoryRequest,
  OrbitEvidenceChunk,
  OrbitEvidenceSearchInput,
  OrbitMemoryObject,
  OrbitQrAuthPollInput,
  OrbitQrAuthResult,
  OrbitQrAuthSession,
  OrbitQrAuthWaitOptions,
  CreateOrbitQrAuthSessionInput,
  OrbitSearchHit,
  OrbitUserMemory,
} from "./types.js";
import { createOrbitBookmarksApi, type OrbitBookmarksApi } from "./bookmarks.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 90_000;

export interface OrbitClientConfig {
  baseUrl: string;
  /**
   * Protocol path appended to baseUrl. Defaults to /orbit/v1 and is not
   * duplicated when baseUrl already ends with that path.
   */
  apiPath?: string | false;
  apiKey?: string;
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  uploadTimeoutMs?: number;
  client?: {
    version?: string;
    platform?: string;
  };
}

export class OrbitClient {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly clientVersion?: string;
  private readonly clientPlatform?: string;
  readonly bookmarks: OrbitBookmarksApi;

  constructor(config: OrbitClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl, config.apiPath);
    this.apiKey = config.apiKey;
    this.fetchImpl = config.fetch ?? fetch;
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.clientVersion = config.client?.version;
    this.clientPlatform = config.client?.platform;
    this.bookmarks = createOrbitBookmarksApi({
      request: <T>(path: string, init: RequestInit) => this.request<T>(path, init),
      fetch: (input, init, timeoutMs) => this.fetchWithTimeout(input, init, timeoutMs),
      uploadTimeoutMs: config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
    });
  }

  memories = {
    create: (input: CreateOrbitMemoryRequest) =>
      this.request<OrbitMemoryObject>("/memories", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    get: (memoryId: string) =>
      this.request<OrbitMemoryObject>(`/memories/${encodeURIComponent(memoryId)}`),
    list: (options: { limit?: number; cursor?: string } = {}) => {
      const params = new URLSearchParams();
      if (options.limit) params.set("limit", String(options.limit));
      if (options.cursor) params.set("cursor", options.cursor);
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return this.request<{ memories: OrbitMemoryObject[]; nextCursor?: string | null }>(`/memories${suffix}`);
    },
  };

  evidence = {
    search: (input: Omit<OrbitEvidenceSearchInput, "ownerId">) =>
      this.request<{ results: Array<OrbitSearchHit<OrbitEvidenceChunk>> }>("/evidence/search", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  };

  userMemories = {
    list: () => this.request<{ memories: OrbitUserMemory[] }>("/user-memories"),
    delete: (memoryId: string) =>
      this.request<void>(`/user-memories/${encodeURIComponent(memoryId)}`, {
        method: "DELETE",
      }),
  };

  auth = {
    qr: {
      create: (input: CreateOrbitQrAuthSessionInput = {}) =>
        this.request<OrbitQrAuthSession>("/auth/qr/sessions", {
          method: "POST",
          body: JSON.stringify(input),
        }),
      poll: ({ sessionId, code }: OrbitQrAuthPollInput) => {
        const params = new URLSearchParams({ code });
        return this.request<OrbitQrAuthResult>(
          `/auth/qr/sessions/${encodeURIComponent(sessionId)}?${params.toString()}`
        );
      },
      authorize: ({ sessionId, code }: OrbitQrAuthPollInput) =>
        this.request<OrbitQrAuthResult>(
          `/auth/qr/sessions/${encodeURIComponent(sessionId)}/authorize`,
          {
            method: "POST",
            body: JSON.stringify({ code }),
          }
        ),
      cancel: ({ sessionId, code }: OrbitQrAuthPollInput) =>
        this.request<OrbitQrAuthResult>(
          `/auth/qr/sessions/${encodeURIComponent(sessionId)}/cancel`,
          {
            method: "POST",
            body: JSON.stringify({ code }),
          }
        ),
      waitForAuthorization: (
        session: OrbitQrAuthSession | OrbitQrAuthPollInput,
        options: OrbitQrAuthWaitOptions = {}
      ) => this.waitForQrAuthorization(session, options),
    },
  };

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    if (this.apiKey) headers.set("authorization", `Bearer ${this.apiKey}`);
    if (this.clientVersion) headers.set("x-orbb-app-version", this.clientVersion);
    if (this.clientPlatform) headers.set("x-orbb-client-platform", this.clientPlatform);

    const response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    }, this.requestTimeoutMs);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Orbit request failed: ${response.status} ${text}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  private async fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Orbit request timed out. An idempotent operation can be retried safely.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async waitForQrAuthorization(
    session: OrbitQrAuthSession | OrbitQrAuthPollInput,
    options: OrbitQrAuthWaitOptions
  ): Promise<OrbitQrAuthResult> {
    const startedAt = Date.now();
    const pollIntervalMs =
      options.pollIntervalMs ??
      ("pollAfterMs" in session && session.pollAfterMs ? session.pollAfterMs : 2000);

    while (true) {
      if (options.signal?.aborted) {
        throw new Error("QR auth wait aborted.");
      }
      if (options.timeoutMs && Date.now() - startedAt > options.timeoutMs) {
        throw new Error("QR auth wait timed out.");
      }

      const result = await this.auth.qr.poll(session);
      if (result.status !== "pending") return result;
      await delay(pollIntervalMs, options.signal);
    }
  }
}

export function normalizeOrbitBaseUrl(baseUrl: string, apiPath: string | false = "/orbit/v1"): string {
  return normalizeBaseUrl(baseUrl, apiPath);
}

function normalizeBaseUrl(baseUrl: string, apiPath: string | false = "/orbit/v1"): string {
  const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
  if (!apiPath) return cleanBaseUrl;

  const cleanApiPath = `/${apiPath.replace(/^\/+|\/+$/g, "")}`;
  if (cleanApiPath === "/") return cleanBaseUrl;
  if (cleanBaseUrl.endsWith(cleanApiPath)) return cleanBaseUrl;
  return `${cleanBaseUrl}${cleanApiPath}`;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("QR auth wait aborted."));
      return;
    }
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("QR auth wait aborted."));
    }, { once: true });
  });
}
