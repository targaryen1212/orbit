/** Base class for every error thrown by the Orbit SDK. */
export class OrbitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * A response the Orbit service answered with a non-2xx status. Carries the
 * HTTP status, the service's machine-readable error code when present, and
 * the parsed response body so callers can branch without parsing messages.
 */
export class OrbitApiError extends OrbitError {
  readonly status: number;
  readonly code?: string;
  readonly body?: unknown;

  constructor(message: string, options: { status: number; code?: string; body?: unknown }) {
    super(message);
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }
}

/** A request that exceeded its timeout budget, including retries. */
export class OrbitTimeoutError extends OrbitError {
  constructor(message = "Orbit request timed out. An idempotent operation can be retried safely.") {
    super(message);
  }
}

/** A wait or request cancelled through a caller-supplied AbortSignal. */
export class OrbitAbortError extends OrbitError {
  constructor(message = "Orbit operation aborted.") {
    super(message);
  }
}

const MAX_ERROR_BODY_CHARS = 300;

export async function orbitApiErrorFromResponse(response: Response, fallback: string): Promise<OrbitApiError> {
  const text = await response.text().catch(() => "");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }

  const envelope = body as { error?: { code?: string; message?: string }; message?: string; code?: string } | undefined;
  const code = envelope?.error?.code ?? envelope?.code;
  const message =
    envelope?.error?.message ??
    envelope?.message ??
    (text ? truncate(text, MAX_ERROR_BODY_CHARS) : undefined);

  return new OrbitApiError(`${fallback}: ${response.status}${message ? ` ${message}` : ""}`, {
    status: response.status,
    code,
    body,
  });
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;
}
