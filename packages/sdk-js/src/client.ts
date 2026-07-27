import type {
  CreateOrbitItemRequest,
  OrbitEvidenceChunk,
  OrbitEvidenceSearchInput,
  OrbitExtensionAuthRevokeResult,
  OrbitItem,
  OrbitListItemsResponse,
  OrbitListUserFactsResponse,
  OrbitQrAuthPollInput,
  OrbitQrAuthResult,
  OrbitQrAuthSession,
  OrbitQrAuthWaitOptions,
  CreateOrbitQrAuthSessionInput,
  OrbitSearchHit,
  OrbitUserFact,
  UpdateOrbitItemRequest,
} from "./types.js";
import { createOrbitBookmarksApi, type OrbitBookmarksApi } from "./bookmarks.js";
import {
  OrbitAbortError,
  OrbitApiError,
  OrbitTimeoutError,
  orbitApiErrorFromResponse,
} from "./errors.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 90_000;
const DEFAULT_RETRY: Required<OrbitRetryConfig> = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
};
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "PUT", "DELETE"]);
const MAX_TRANSIENT_QR_POLL_FAILURES = 3;

export interface OrbitRetryConfig {
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Base backoff delay; doubles per attempt with jitter. Defaults to 250ms. */
  baseDelayMs?: number;
  /** Backoff ceiling, also caps honored Retry-After values. Defaults to 4s. */
  maxDelayMs?: number;
}

export interface OrbitRequestOptions {
  signal?: AbortSignal;
}

export interface OrbitClientConfig {
  baseUrl: string;
  /**
   * Protocol path appended to baseUrl. Defaults to /orbit/v1 and is not
   * duplicated when baseUrl already ends with that path.
   */
  apiPath?: string | false;
  /**
   * Bearer credential, or a resolver invoked per request so long-lived
   * clients can rotate tokens without rebuilding the client.
   */
  apiKey?: string | (() => string | undefined | Promise<string | undefined>);
  fetch?: typeof fetch;
  requestTimeoutMs?: number;
  uploadTimeoutMs?: number;
  /**
   * Automatic retry with exponential backoff for idempotent requests
   * (GET/PUT/DELETE or any request carrying an idempotency-key header) that
   * fail with a network error, timeout, 408, 429, or 5xx. Pass false to
   * disable.
   */
  retry?: OrbitRetryConfig | false;
  client?: {
    version?: string;
    platform?: string;
  };
}

export class OrbitClient {
  private readonly baseUrl: string;
  private readonly apiKey?: OrbitClientConfig["apiKey"];
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly retry: Required<OrbitRetryConfig> | false;
  private readonly clientVersion?: string;
  private readonly clientPlatform?: string;
  readonly bookmarks: OrbitBookmarksApi;

  constructor(config: OrbitClientConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl, config.apiPath);
    this.apiKey = config.apiKey;
    this.fetchImpl = (config.fetch ?? globalThis.fetch).bind(globalThis);
    this.requestTimeoutMs = config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.retry = config.retry === false ? false : { ...DEFAULT_RETRY, ...config.retry };
    this.clientVersion = config.client?.version;
    this.clientPlatform = config.client?.platform;
    this.bookmarks = createOrbitBookmarksApi({
      request: <T>(path: string, init: RequestInit) => this.request<T>(path, init),
      fetch: (input, init, timeoutMs) => this.fetchWithTimeout(input, init, timeoutMs),
      uploadTimeoutMs: config.uploadTimeoutMs ?? DEFAULT_UPLOAD_TIMEOUT_MS,
    });
  }

  items = {
    create: (input: CreateOrbitItemRequest, options: OrbitRequestOptions = {}) =>
      this.request<OrbitItem>("/items", {
        method: "POST",
        body: JSON.stringify(input),
        signal: options.signal,
      }),
    get: (itemId: string, options: OrbitRequestOptions = {}) =>
      this.request<OrbitItem>(`/items/${encodeURIComponent(itemId)}`, {
        signal: options.signal,
      }),
    update: (itemId: string, patch: UpdateOrbitItemRequest, options: OrbitRequestOptions = {}) =>
      this.request<OrbitItem>(`/items/${encodeURIComponent(itemId)}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
        signal: options.signal,
      }),
    delete: (itemId: string, options: OrbitRequestOptions = {}) =>
      this.request<void>(`/items/${encodeURIComponent(itemId)}`, {
        method: "DELETE",
        signal: options.signal,
      }),
    list: (options: { limit?: number; cursor?: string } & OrbitRequestOptions = {}) => {
      const params = new URLSearchParams();
      if (options.limit) params.set("limit", String(options.limit));
      if (options.cursor) params.set("cursor", options.cursor);
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return this.request<OrbitListItemsResponse>(`/items${suffix}`, {
        signal: options.signal,
      });
    },
    /** Iterate every saved item across pages, newest first. */
    iterate: (options: { pageSize?: number } & OrbitRequestOptions = {}): AsyncGenerator<OrbitItem> =>
      this.iterateItems(options),
  };

  evidence = {
    search: (input: Omit<OrbitEvidenceSearchInput, "ownerId">, options: OrbitRequestOptions = {}) =>
      this.request<{ results: Array<OrbitSearchHit<OrbitEvidenceChunk>> }>("/evidence/search", {
        method: "POST",
        body: JSON.stringify(input),
        signal: options.signal,
      }),
  };

  userFacts = {
    list: (options: { limit?: number; cursor?: string } & OrbitRequestOptions = {}) => {
      const params = new URLSearchParams();
      if (options.limit) params.set("limit", String(options.limit));
      if (options.cursor) params.set("cursor", options.cursor);
      const suffix = params.size > 0 ? `?${params.toString()}` : "";
      return this.request<OrbitListUserFactsResponse>(`/user-facts${suffix}`, {
        signal: options.signal,
      });
    },
    delete: (factId: string, options: OrbitRequestOptions = {}) =>
      this.request<void>(`/user-facts/${encodeURIComponent(factId)}`, {
        method: "DELETE",
        signal: options.signal,
      }),
  };

  auth = {
    revokeCurrentSession: (options: OrbitRequestOptions = {}) =>
      this.request<OrbitExtensionAuthRevokeResult>("/auth/extension/revoke", {
        method: "POST",
        signal: options.signal,
      }),
    qr: {
      create: (input: CreateOrbitQrAuthSessionInput = {}, options: OrbitRequestOptions = {}) =>
        this.request<OrbitQrAuthSession>("/auth/qr/sessions", {
          method: "POST",
          body: JSON.stringify(input),
          signal: options.signal,
        }),
      poll: ({ sessionId, code }: OrbitQrAuthPollInput, options: OrbitRequestOptions = {}) =>
        this.request<OrbitQrAuthResult>(
          `/auth/qr/sessions/${encodeURIComponent(sessionId)}`,
          {
            method: "POST",
            body: JSON.stringify({ code }),
            signal: options.signal,
          }
        ),
      authorize: ({ sessionId, code }: OrbitQrAuthPollInput, options: OrbitRequestOptions = {}) =>
        this.request<OrbitQrAuthResult>(
          `/auth/qr/sessions/${encodeURIComponent(sessionId)}/authorize`,
          {
            method: "POST",
            body: JSON.stringify({ code }),
            signal: options.signal,
          }
        ),
      cancel: ({ sessionId, code }: OrbitQrAuthPollInput, options: OrbitRequestOptions = {}) =>
        this.request<OrbitQrAuthResult>(
          `/auth/qr/sessions/${encodeURIComponent(sessionId)}/cancel`,
          {
            method: "POST",
            body: JSON.stringify({ code }),
            signal: options.signal,
          }
        ),
      waitForAuthorization: (
        session: OrbitQrAuthSession | OrbitQrAuthPollInput,
        options: OrbitQrAuthWaitOptions = {}
      ) => this.waitForQrAuthorization(session, options),
    },
  };

  private async *iterateItems(
    options: { pageSize?: number } & OrbitRequestOptions
  ): AsyncGenerator<OrbitItem> {
    let cursor: string | undefined;
    while (true) {
      const page = await this.items.list({
        limit: options.pageSize,
        cursor,
        signal: options.signal,
      });
      for (const item of page.items) yield item;
      if (!page.nextCursor || page.items.length === 0) return;
      cursor = page.nextCursor;
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body) headers.set("content-type", "application/json");
    const apiKey = await this.resolveApiKey();
    if (apiKey) headers.set("authorization", `Bearer ${apiKey}`);
    if (this.clientVersion) headers.set("x-orbb-app-version", this.clientVersion);
    if (this.clientPlatform) headers.set("x-orbb-client-platform", this.clientPlatform);

    const method = (init.method ?? "GET").toUpperCase();
    const idempotent = IDEMPOTENT_METHODS.has(method) || headers.has("idempotency-key");
    const maxAttempts = this.retry && idempotent ? this.retry.maxAttempts : 1;

    for (let attempt = 1; ; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchWithTimeout(`${this.baseUrl}${path}`, {
          ...init,
          headers,
        }, this.requestTimeoutMs);
      } catch (error) {
        if (attempt < maxAttempts && isRetryableTransportError(error, init.signal)) {
          await this.backoff(attempt, undefined, init.signal ?? undefined);
          continue;
        }
        throw error;
      }

      if (!response.ok) {
        const apiError = await orbitApiErrorFromResponse(response, "Orbit request failed");
        if (attempt < maxAttempts && isRetryableStatus(response.status)) {
          await this.backoff(attempt, response.headers.get("retry-after"), init.signal ?? undefined);
          continue;
        }
        throw apiError;
      }

      if (response.status === 204) return undefined as T;
      return response.json() as Promise<T>;
    }
  }

  private async resolveApiKey(): Promise<string | undefined> {
    return typeof this.apiKey === "function" ? this.apiKey() : this.apiKey;
  }

  private async backoff(attempt: number, retryAfterHeader?: string | null, signal?: AbortSignal): Promise<void> {
    if (!this.retry) return;
    const exponential = Math.min(
      this.retry.maxDelayMs,
      this.retry.baseDelayMs * 2 ** (attempt - 1)
    );
    const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
    const base = retryAfterMs !== undefined
      ? Math.min(retryAfterMs, this.retry.maxDelayMs)
      : exponential;
    const jittered = base / 2 + Math.random() * (base / 2);
    await delay(jittered, signal);
  }

  private async fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit,
    timeoutMs: number,
  ): Promise<Response> {
    const callerSignal = init.signal ?? undefined;
    if (callerSignal?.aborted) throw new OrbitAbortError();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const detachCallerAbort = forwardAbort(callerSignal, controller);
    try {
      return await this.fetchImpl(input, { ...init, signal: controller.signal });
    } catch (error) {
      if (callerSignal?.aborted) throw new OrbitAbortError();
      if (controller.signal.aborted) throw new OrbitTimeoutError();
      throw error;
    } finally {
      clearTimeout(timeout);
      detachCallerAbort();
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

    let transientFailures = 0;
    while (true) {
      if (options.signal?.aborted) {
        throw new OrbitAbortError("QR auth wait aborted.");
      }
      if (options.timeoutMs && Date.now() - startedAt > options.timeoutMs) {
        throw new OrbitTimeoutError("QR auth wait timed out.");
      }

      let result: OrbitQrAuthResult;
      try {
        result = await this.auth.qr.poll(session, { signal: options.signal });
        transientFailures = 0;
      } catch (error) {
        // A blip mid-poll must not abandon a login the user already approved
        // on their phone; only persistent or definitive failures surface.
        if (isTransientPollError(error) && transientFailures < MAX_TRANSIENT_QR_POLL_FAILURES) {
          transientFailures += 1;
          await delay(pollIntervalMs, options.signal);
          continue;
        }
        throw error;
      }
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

function forwardAbort(source: AbortSignal | undefined, target: AbortController): () => void {
  if (!source) return () => {};
  const onAbort = () => target.abort();
  source.addEventListener("abort", onAbort, { once: true });
  return () => source.removeEventListener("abort", onAbort);
}

function isRetryableTransportError(error: unknown, callerSignal?: AbortSignal | null): boolean {
  if (callerSignal?.aborted) return false;
  if (error instanceof OrbitAbortError) return false;
  if (error instanceof OrbitTimeoutError) return true;
  // fetch surfaces network failures as TypeError in every mainstream runtime.
  return error instanceof TypeError;
}

function isRetryableStatus(status: number): boolean {
  if (status === 408 || status === 429) return true;
  return status >= 500 && status !== 501;
}

function isTransientPollError(error: unknown): boolean {
  if (error instanceof OrbitAbortError) return false;
  if (error instanceof OrbitTimeoutError) return true;
  if (error instanceof OrbitApiError) return isRetryableStatus(error.status);
  return error instanceof TypeError;
}

function parseRetryAfterMs(header?: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OrbitAbortError("Orbit wait aborted."));
      return;
    }
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      reject(new OrbitAbortError("Orbit wait aborted."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
