# Orbit

Orbit defines a common API for user-owned saved content. Apps can use the same
schemas and client methods to save URLs, notes, media, and extracted details
without depending on one service's database layout.

Orbb is the first production adapter. The Orbb app remains private while the
data contract and SDK can be shared.

## Data model

- `OrbitItem`: one saved item.
- `EvidenceChunk`: searchable text derived from a saved item.
- `Entity`: a person, place, organization, or topic found in an item.
- `Resource`: a structured item such as a book, place, song, movie, or product.
- `UserFact`: a durable user fact or preference, kept separate from saved
  content.

Every private read and write is scoped to its owner. Search implementations are
service internals; raw index data is not part of the public contract.

## Project layout

```txt
orbit/
  specs/                JSON schemas and OpenAPI definition
  packages/sdk-js/      TypeScript client, types, and local test store
  examples/             Runnable examples
  docs/                 Protocol and adapter notes
```

## Quickstart

```bash
cd orbit
npm install
npm run build
npm run check
npm test
npm run example:local
```

## Local example

```ts
import { LocalOrbitStore } from "@orbb/orbit-sdk";

const store = new LocalOrbitStore();

const item = await store.putItem({
  ownerId: "user_raj",
  source: {
    type: "url",
    url: "https://example.com/tokyo-cafe",
    platform: "web",
  },
  title: "Quiet Tokyo cafe",
  summary: "A cafe in Shimokitazawa with matcha lattes and late hours.",
  tags: ["tokyo", "cafe", "travel"],
});

await store.indexItem(item.id, item.ownerId);

const results = await store.searchEvidence({
  ownerId: "user_raj",
  query: "Tokyo cafe",
  limit: 5,
});
```

## HTTP client

```ts
import { OrbitClient } from "@orbb/orbit-sdk";

const client = new OrbitClient({
  baseUrl: "https://api.example.com",
  apiKey: process.env.ORBIT_API_KEY,
});

// Requests https://api.example.com/orbit/v1/items
const { items } = await client.items.list();

// Walk every page; update and delete round out the item lifecycle.
for await (const item of client.items.iterate({ pageSize: 50 })) {
  console.log(item.title);
}
await client.items.update(itemId, { note: "Read this again in spring." });
await client.items.delete(itemId);
```

Public services must derive `ownerId` from the authenticated request. The local
store accepts it explicitly because it has no authentication layer.

`apiKey` also accepts a resolver function invoked per request, so long-lived
clients can rotate tokens without rebuilding the client:

```ts
const client = new OrbitClient({
  baseUrl: "https://api.example.com",
  apiKey: () => tokenStore.currentAccessToken(),
});
```

## Two save paths

`client.bookmarks.createItem` is the production ingestion route used by the
Orbb browser extension: it uploads local media, derives idempotency keys so
retries never duplicate a save, and hands content to Orbb's processing
pipeline. `client.items.create` is the open Orbit protocol route defined in
`specs/orbit-openapi.yaml`. New integrations against the Orbb backend should
use `bookmarks`; adapters implementing the protocol serve `items`.

```ts
await client.bookmarks.createItem(
  {
    source: { type: "url", url: "https://example.com/story", platform: "web" },
    title: "Story",
  },
  // URL saves derive a stable key automatically. For text or media captures,
  // pass an explicit key if a retry may happen with a re-built request object
  // (for example after a service-worker restart).
  { idempotencyKey: "save-2026-07-27-story" },
);
```

## Errors, timeouts, and retries

Failed requests throw `OrbitApiError` with `status`, a machine-readable
`code`, and the parsed response `body`; timeouts throw `OrbitTimeoutError`,
and caller-initiated aborts throw `OrbitAbortError`. Every method accepts an
`AbortSignal` via its options argument.

Idempotent requests (GET/PUT/DELETE, or anything carrying an
`idempotency-key` header) automatically retry with exponential backoff on
network errors, timeouts, 408, 429, and 5xx. Tune or disable with the `retry`
config option.

```ts
import { OrbitApiError } from "@orbb/orbit-sdk";

try {
  await client.items.get(id);
} catch (error) {
  if (error instanceof OrbitApiError && error.isAuthError) {
    await signInAgain();
  }
}
```

## QR sign-in

Companion apps sign in by showing a QR code that the phone app authorizes:

```ts
const session = await client.auth.qr.create({ client: { type: "extension" } });
showQr(session.qrImageUrl ?? session.verificationUriComplete);

const result = await client.auth.qr.waitForAuthorization(session, {
  timeoutMs: 120_000,
});
if (result.status === "authorized") {
  await completeSignIn(result.token);
}
```

The wait loop tolerates brief network blips and stops on abort, timeout,
expiry, or cancellation.

## Status

Orbit is an early contract built around Orbb's current save, search, and
resource APIs.
