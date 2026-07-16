# Orbit Protocol

Orbit is spec-first. The protocol defines stable JSON shapes and operations;
storage engines and AI providers are adapters.

## Namespaces

All private reads and writes are scoped by `ownerId`.

Public API adapters must derive `ownerId` from authenticated request context
and ignore or reject caller-supplied owner identifiers. Local/offline stores may
accept `ownerId` as an explicit namespace argument because they do not have an
auth boundary.

```txt
ownerId=user_raj
  memories/
  evidenceChunks/
  userMemories/
  relations/
```

Embeddings can live in a shared vector space when they use the same
`embedding.model`, but search must apply the owner boundary first:

```txt
query embedding -> filter ownerId -> nearest evidence chunks
```

## Embedding Rule

Only compare vectors that use the same embedding model and dimensions.

```json
{
  "model": "openai/text-embedding-3-large",
  "dimensions": 3072,
  "vector": [0.012, -0.44, 0.91]
}
```

Provider adapters may store vectors in Firestore, Postgres/pgvector, SQLite,
Qdrant, LanceDB, or any equivalent vector index.

Search response DTOs should omit vectors by default. Adapters may expose vectors
only behind an explicit `includeVectors` request flag for trusted debugging or
export flows.

## Retrieval Rule

The canonical retrieval unit is `EvidenceChunk`, not the whole memory object.
Memory objects are useful for display; evidence chunks are useful for answers.

Evidence chunks may copy relevant entities, tags, and resources from their
source memory so retrieval systems can filter and display grounded context
without fetching the full memory first.

## Privacy Rule

Orbit adapters must default to private memory. Cross-user search is invalid
unless the memory has an explicit shared or public scope.

Adapters must apply `privacy.redaction` before indexing evidence or generating
embeddings. Redaction entries are source-field paths such as `summary`, `note`,
`content.text`, or `content.transcript`; parent paths such as `content` redact
all descendant fields. The JS local store implements this by skipping evidence
chunks whose `sourceFields` match a redacted path.

## Place Coordinates

Place resources may carry first-class coordinates. Coordinates describe the
place mentioned by a memory, not necessarily the user's capture location.

```json
{
  "name": "Neko Cafe",
  "type": "Place",
  "geo": {
    "latitude": 35.6613,
    "longitude": 139.6665,
    "precision": "approximate",
    "source": "google_places"
  },
  "address": {
    "label": "Shimokitazawa, Setagaya City, Tokyo, Japan",
    "locality": "Tokyo",
    "country": "Japan",
    "countryCode": "JP"
  }
}
```

The standalone JSON schema for this shape is
`specs/schemas/orbit-resource.schema.json`; memory objects and evidence chunks
both reference it.
