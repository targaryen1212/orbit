# @orbb/orbit-sdk

TypeScript types and a small HTTP client for Orbit-compatible save services.

The package includes:

- Request and response types.
- `OrbitClient` for authenticated API calls.
- Bookmark ingestion helpers for URLs, text, and local media.
- QR sign-in helpers for browser extensions.
- A local in-memory store for tests and examples.

Search indexing belongs to the service. The SDK does not create, store, return,
or expose internal search-index data.

## Connecting to a service

`@orbb/orbit-sdk` is a client library. Network operations, including QR
authentication, require a reachable Orbit-compatible service. `LocalOrbitStore`
is an in-memory test store and does not provide an authentication server.

### Orbb-hosted QR capture

Orbb provides a hosted service for QR-authenticated capture clients:

```ts
import { OrbitClient } from "@orbb/orbit-sdk";

const client = new OrbitClient({
  baseUrl: "https://api.orbb.app/v2",
  apiPath: false,
});
```

Use this configuration for browser extensions and local, desktop, or web
capture apps. The app must be online, but it does not need its own backend or a
pre-issued API key. QR sign-in returns a user-authorized bearer token.

The optional `client.version` value is telemetry for identifying client
releases; Orbb does not require it to accept a request. `client.platform` is
also optional, but is useful when diagnosing integrations:

```ts
const client = new OrbitClient({
  baseUrl: "https://api.orbb.app/v2",
  apiPath: false,
  client: { platform: "my-capture-app" },
});
```

Current Orbb QR tokens permit capture operations such as creating bookmarks,
checking whether URLs already exist, and uploading media. They do not permit
listing or searching the user's content.

### Orbb API keys

Orbb API keys are for private servers and personal automations using the public
Orbb REST API at `https://api.orbb.app/v1`. The current `OrbitClient` does not
wrap that `/v1/tools/*` API.

Create a key in Orbb under **Settings → Orbb API**, select only the required
`read`, `write`, or `ai` scopes, and copy the key when it is shown. Orbb does
not show the complete key again. Send it as a bearer token when calling the
public REST API directly.

Never commit an API key to source control or embed one in a browser extension,
website, mobile app, or desktop app. API keys act as the user who created them.
Public applications should use OAuth with PKCE.

### Other Orbit-compatible services

For other service providers, use the base URL and bearer credential supplied
by that provider:

```ts
const client = new OrbitClient({
  baseUrl: "https://api.example.com",
  apiKey: process.env.ORBIT_API_KEY,
});
```

`OrbitClient` appends `/orbit/v1` by default and avoids duplicating it when the
base URL already contains the protocol path. Use `apiPath: false` for fully
custom routes, or pass a path such as `/content/v2`.

## Saving content

Authenticated clients can submit content through the bookmark ingestion API
without constructing service-specific routes. The SDK uploads and finalizes
local media before creating the bookmark.

```ts
await client.bookmarks.createItem({
  source: { type: "url", url: "https://example.com/story", platform: "web" },
  title: "A useful story",
  privacy: { scope: "private" },
});

await client.bookmarks.createItem({
  source: {
    type: "note",
    text: "Good research often starts by following the surprising thread.",
    platform: "fieldnotes",
  },
  content: {
    text: "Good research often starts by following the surprising thread.",
  },
  title: "Follow the surprising thread",
  privacy: { scope: "private" },
});

const existing = await client.bookmarks.findExistingUrls([
  "https://example.com/story",
]);
```

`source.url` is required for URL captures but is intentionally absent from
note-only captures. Give notes their text in `source.text`, `content.text`, or
both.

Bookmark and media writes use stable, stage-specific idempotency keys. If the
caller has a durable capture ID, pass it as the second argument:

```ts
await client.bookmarks.createItem(item, { idempotencyKey: "capture-123" });
```

URL captures derive a key automatically from normalized request content.
Captures without a URL derive one from the request object's identity, which
does not survive a process restart or a re-built request object — pass an
explicit key whenever a retry may happen with a new object (for example after
a service-worker restart). `metadata.idempotencyKey` remains supported for
backward compatibility.

Bookmark writes leave `category` unset so the Orbb processing pipeline can
classify the item from its content.

## Errors, timeouts, and retries

Failed requests throw `OrbitApiError` carrying `status`, a machine-readable
`code`, and the parsed response `body` (plus `isAuthError` and `isRateLimit`
helpers). Timeouts throw `OrbitTimeoutError`; caller-initiated aborts throw
`OrbitAbortError`. Every method accepts an `AbortSignal` through its options
argument.

Idempotent requests — GET/PUT/DELETE, or any request carrying an
`idempotency-key` header, which includes all bookmark and media writes —
automatically retry with exponential backoff on network errors, timeouts,
408, 429, and 5xx responses. Configure with `retry` (or disable with
`retry: false`):

```ts
const client = new OrbitClient({
  baseUrl: "https://api.orbb.app/v2",
  apiPath: false,
  retry: { maxAttempts: 4, baseDelayMs: 500 },
});
```

Long-lived clients can supply `apiKey` as a function; it is resolved on every
request, so rotated tokens take effect without rebuilding the client.

## Reading and maintaining items

```ts
for await (const item of client.items.iterate({ pageSize: 50 })) {
  console.log(item.title);
}

await client.items.update(itemId, { note: "Revisit in spring." });
await client.items.delete(itemId);
```

`items.*` follows the open Orbit protocol in `specs/orbit-openapi.yaml`;
deployments may enable these routes progressively.

### Same-origin web proxies

A browser app may point `OrbitClient` at a same-origin proxy when direct
cross-origin requests are unsuitable:

```ts
const client = new OrbitClient({
  baseUrl: `${window.location.origin}/api/orbb`,
  apiPath: false,
  apiKey: qrAccessToken,
  client: { platform: "my-capture-app" },
});
```

`bookmarks.createItem()` converts the public Orbit item into Orbb's bookmark
request before sending it. The proxy must therefore forward that generated
request unchanged to `https://api.orbb.app/v2/bookmarks`, including the
`authorization`, `idempotency-key`, `content-type`, and optional
`x-orbb-client-platform` headers.

Do not parse the proxy body as `CreateOrbitItemRequest` and call
`bookmarks.createItem()` again on the server. That would translate the request
twice and can make fields such as `source` appear to be missing.

## QR sign-in

Creating and polling a QR session does not require an API key. Display
`verificationUriComplete` as a QR code for the user to authorize in Orbb. An
authorized session delivers its credential once; later polls return
`consumed`, so store the returned token securely.

```ts
const connection = {
  baseUrl: "https://api.orbb.app/v2",
  apiPath: false as const,
};

const authClient = new OrbitClient(connection);
const session = await authClient.auth.qr.create({
  client: { type: "desktop_app", name: "Orbit Fieldnotes" },
});

// Render session.verificationUriComplete as a QR code.
const result = await authClient.auth.qr.waitForAuthorization(session);
const accessToken = result.token?.accessToken;
if (result.status !== "authorized" || !accessToken) {
  throw new Error(`QR authorization failed: ${result.status}`);
}

const client = new OrbitClient({
  ...connection,
  apiKey: accessToken,
});

await client.bookmarks.createItem({
  source: { type: "url", url: "https://example.com/story" },
  title: "Saved with Orbit",
});

// During sign-out, revoke the session before deleting the stored token.
await client.auth.revokeCurrentSession();
```

For a Chrome extension, identify the client with:

```ts
client: { type: "chrome_extension", extensionId: chrome.runtime.id }
```

## Local store

`LocalOrbitStore` provides owner-scoped storage, evidence extraction, filters,
and keyword search for tests. Production services may use any private search
implementation as long as the public response matches the protocol.

```ts
import { LocalOrbitStore } from "@orbb/orbit-sdk";

const store = new LocalOrbitStore();
const item = await store.putItem({
  ownerId: "user_raj",
  source: { type: "text", text: "Quiet Tokyo cafe with late hours." },
});

await store.indexItem(item.id, item.ownerId);
```

For public creates, `ownerId` is intentionally absent from the request type.
Servers must bind ownership from the authenticated request context.
