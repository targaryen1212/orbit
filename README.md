# Orbit

Orbit is an open protocol for portable AI memory. It gives apps a common way
to save, enrich, retrieve, and exchange personal context without locking memory
inside one product.

Orbb can become the first polished app built on Orbit. The app stays private;
the memory contract, SDK, and adapters can be open source.

## Core Idea

Orbit separates five concepts:

- `MemoryObject`: the thing a user saved, wrote, spoke, saw, or imported.
- `EvidenceChunk`: the grounded retrieval unit used for semantic search and RAG.
- `Entity`: people, places, organizations, and topics extracted from memory.
- `Resource`: typed objects found inside memory, such as books, places, songs,
  movies, products, apps, and courses.
- `UserMemory`: durable facts or preferences about the user, separate from saved
  content.

Every user can use the same embedding model, but vectors must be searched inside
that user's namespace unless the user explicitly shares a memory.

## Project Layout

```txt
orbit/
  specs/
    orbit-openapi.yaml
    schemas/
  packages/
    sdk-js/
  examples/
    node-local-memory/
  docs/
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

## Example

```ts
import {
  LocalOrbitStore,
  createDeterministicEmbeddingProvider,
} from "@orbit-memory/sdk";

const store = new LocalOrbitStore({
  embeddingProvider: createDeterministicEmbeddingProvider(),
});

const memory = await store.putMemory({
  ownerId: "user_raj",
  source: {
    type: "url",
    url: "https://example.com/tokyo-cafe",
    platform: "web",
  },
  title: "Quiet Tokyo cafe",
  summary: "A quiet cafe in Shimokitazawa with matcha lattes and late hours.",
  tags: ["tokyo", "cafe", "travel"],
  entities: {
    places: ["Tokyo", "Shimokitazawa"],
    topics: ["coffee", "quiet cafes"],
  },
});

await store.indexMemory(memory.id, memory.ownerId);

const results = await store.searchEvidence({
  ownerId: "user_raj",
  query: "quiet cafes in Tokyo",
  limit: 5,
});
```

HTTP clients default to the protocol path:

```ts
import { OrbitClient } from "@orbit-memory/sdk";

const client = new OrbitClient({
  baseUrl: "https://api.example.com",
  apiKey: process.env.ORBIT_API_KEY,
});

// Requests https://api.example.com/orbit/v1/memories
const { memories } = await client.memories.list();
```

For public HTTP adapters, `ownerId` must come from the authenticated user
context, not from caller-supplied JSON. The local in-memory store still accepts
`ownerId` because it has no auth layer.

## Status

This is a seed project. The first production milestone is to expose Orbb's
existing bookmark/evidence/resource/memory data through Orbit-compatible
serializers and a `/orbit/v1` API.
