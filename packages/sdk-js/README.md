# @orbit-memory/sdk

TypeScript SDK for Orbit, an open protocol for portable AI memory.

The SDK includes:

- Protocol types.
- A small HTTP client for Orbit-compatible APIs.
- A local in-memory store for demos, tests, and adapter development.
- A deterministic development embedding provider.

```ts
import { LocalOrbitStore, createDeterministicEmbeddingProvider } from "@orbit-memory/sdk";

const store = new LocalOrbitStore({
  embeddingProvider: createDeterministicEmbeddingProvider(),
});

const memory = await store.putMemory({
  ownerId: "user_raj",
  source: { type: "text", text: "Quiet Tokyo cafe with late hours." },
});

await store.indexMemory(memory.id, memory.ownerId);
```

```ts
import { OrbitClient } from "@orbit-memory/sdk";

const client = new OrbitClient({
  baseUrl: "https://api.example.com",
  apiKey: process.env.ORBIT_API_KEY,
});
```

Authenticated clients can save protocol memories through Orbit's bookmark
ingestion workflow without constructing service-specific routes. Local media
data is uploaded and finalized by the SDK before the bookmark is created.

```ts
await client.bookmarks.createMemory({
  source: { type: "url", url: "https://example.com/story", platform: "web" },
  title: "A useful story",
  privacy: { scope: "private" },
});

const existing = await client.bookmarks.findExistingUrls([
  "https://example.com/story",
]);
```

Bookmark and media writes include stable stage-specific idempotency keys. Set
`metadata.idempotencyKey` when the caller already has a durable capture ID; it
is used unchanged for the bookmark create. URL captures otherwise derive a
stable key from their normalized request content. Reusing the same request
object safely retries text and local-file captures while separate request
objects remain separate captures.

QR sign-in keeps the private code in a POST body. A completed QR session can
deliver credentials once; later polls return `consumed` without a token. When
signing out, revoke the authenticated extension session before clearing the
local credential.

```ts
const session = await client.auth.qr.create({
  client: { type: "chrome_extension", extensionId: chrome.runtime.id },
});
const result = await client.auth.qr.waitForAuthorization(session);

await client.auth.revokeCurrentSession();
```

`OrbitClient` appends `/orbit/v1` by default and avoids duplicating it when the
base URL already includes the protocol path. Use `apiPath: false` for fully
custom routes, or pass a custom `apiPath` such as `/memory/v2`.

`OrbitStore.indexMemory` is part of the store interface because local adapters
and tests need an explicit indexing step. Public HTTP adapters may index
synchronously or asynchronously after create.

For public HTTP creates, `ownerId` is intentionally absent from the client DTO.
Servers must bind ownership from the authenticated request context.
