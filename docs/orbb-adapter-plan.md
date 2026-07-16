# Orbb Adapter Plan

Orbit should begin as a compatibility layer over the existing Orbb backend.

## Source Data

Current Orbb collections map cleanly to Orbit:

- `users/{uid}/bookmarks/{id}` -> `OrbitMemoryObject`
- `users/{uid}/evidenceChunks/{id}` -> `OrbitEvidenceChunk`
- `users/{uid}/resources/{type}/items/{id}` -> `OrbitResource`
- `users/{uid}/orbbMemory/{id}` -> `OrbitUserMemory`
- `users/{uid}/synapses/{id}` -> `OrbitRelation`

## First Backend Step

Add a new `/orbit/v1` router next to the current public API. Keep the current
API stable, and make Orbit the portable contract.

```txt
nextraCloud/functions/src/
  handlers/orbitApi.ts
  services/orbitSerializers.ts
```

## Serializer Targets

```txt
sanitizeBookmark -> toOrbitMemoryObject
sanitizeEvidenceChunk -> toOrbitEvidenceChunk
resource doc -> toOrbitResource
orbbMemory doc -> toOrbitUserMemory
synapse edge -> toOrbitRelation
```

## What Stays Private

- Orbb app UI.
- Billing and quota logic.
- Production prompts.
- Provider keys.
- Orbb-specific recommendation and engagement flows.

## What Opens

- JSON schemas.
- OpenAPI contract.
- TypeScript SDK.
- Local adapter.
- MCP adapter.
- Firebase/Firestore adapter once the serializer boundary is stable.
