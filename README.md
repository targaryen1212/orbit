# Orbit

Orbit defines a common API for user-owned saved content. Apps can use the same
schemas and client methods to save URLs, notes, media, and extracted details
without depending on one service's database layout.

Orbb is the first production adapter. The Orbb app remains private while the
data contract and SDK can be shared.

## Data model

- `MemoryObject`: one saved item. The name is retained in the API for
  compatibility.
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
```

Public services must derive `ownerId` from the authenticated request. The local
store accepts it explicitly because it has no authentication layer.

## Status

Orbit is an early contract built around Orbb's current save, search, and
resource APIs.
