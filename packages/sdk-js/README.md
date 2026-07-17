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

## Client setup

```ts
import { OrbitClient } from "@orbb/orbit-sdk";

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

const existing = await client.bookmarks.findExistingUrls([
  "https://example.com/story",
]);
```

Bookmark and media writes use stable, stage-specific idempotency keys. If the
caller has a durable capture ID, set `metadata.idempotencyKey`; otherwise URL
captures derive one from normalized request content.

Bookmark writes leave `category` unset so the Orbb processing pipeline can
classify the item from its content.

## QR sign-in

The private QR code is sent in a POST body. An authorized session delivers its
credentials once; later polls return `consumed`. Revoke the server session
before deleting the local credential during sign-out.

```ts
const session = await client.auth.qr.create({
  client: { type: "chrome_extension", extensionId: chrome.runtime.id },
});
const result = await client.auth.qr.waitForAuthorization(session);

await client.auth.revokeCurrentSession();
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
