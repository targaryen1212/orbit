# Orbb Adapter Plan

Orbit begins as a stable client contract over the existing Orbb backend.

## Source Data

The existing Orbb collections map to the current Orbit type names:

- `users/{uid}/bookmarks/{id}` -> `OrbitItem`
- `users/{uid}/evidenceChunks/{id}` -> `OrbitEvidenceChunk`
- `users/{uid}/resources/{type}/items/{id}` -> `OrbitResource`
- `users/{uid}/orbbMemory/{id}` -> `OrbitUserFact`
- `users/{uid}/synapses/{id}` -> `OrbitRelation`

## First Backend Step

Add a new `/orbit/v1` router next to the current public API without changing
existing Orbb routes.

```txt
nextraCloud/functions/src/
  handlers/orbitApi.ts
  services/orbitSerializers.ts
```

## Serializer Targets

```txt
sanitizeBookmark -> toOrbitItem
sanitizeEvidenceChunk -> toOrbitEvidenceChunk
resource doc -> toOrbitResource
orbbMemory doc -> toOrbitUserFact
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
