# Orbit Protocol

Orbit defines JSON request and response shapes. Authentication, persistence,
content processing, and search implementation remain the service's
responsibility.

## Ownership

All private reads and writes are scoped by `ownerId`.

Public API adapters must derive `ownerId` from the authenticated request and
reject caller-supplied owner identifiers. Local stores may accept `ownerId`
explicitly because they do not have an authentication boundary.

```txt
ownerId=user_raj
  items/
  evidenceChunks/
  userFacts/
  relations/
```

Cross-user search is invalid unless an item has an explicit shared or public
scope.

## Search

The public contract contains saved content, searchable evidence, filters, and
ranked results. Search indexes and provider-specific data stay behind the
service boundary and are not included in SDK types, schemas, or API responses.

`EvidenceChunk` is the searchable unit. A saved item is convenient for display;
smaller evidence records let a service return the exact text that matched.

Evidence records may copy relevant entities, tags, and resources from their
source item so clients can filter and display results without another request.

## Privacy

Services must default saved content to private. They must apply
`privacy.redaction` before adding evidence to any search index. Redaction values
are source-field paths such as `summary`, `note`, `content.text`, or
`content.transcript`; a parent path such as `content` redacts every child field.

The local JavaScript store enforces this by skipping evidence whose
`sourceFields` match a redacted path.

## Item lifecycle

Items support update and delete in addition to create, get, and list.

Update (`PATCH /items/{itemId}`) accepts only client-owned fields: `title`,
`summary`, `note`, `tags`, `privacy`, and `metadata`. Server-derived fields
(`source`, `content`, `entities`, `resources`) are not client-writable. After
an update, a service must rebuild or drop the item's derived evidence so
search never returns text the update removed or newly redacted.

Delete (`DELETE /items/{itemId}`) must remove the item and purge its evidence
from every search index. User-owned content requires real deletion; retaining
searchable derivatives of a deleted item violates the contract.

## Errors and retries

Errors use a JSON envelope with a machine-readable code:

```json
{ "error": { "code": "not_found", "message": "Item not found." } }
```

Write routes accept an `idempotency-key` header. A service must treat a
repeated key as a replay of the original operation, not a new one, so clients
can retry timeouts and 5xx responses safely. The reference SDK retries
idempotent requests automatically with exponential backoff and honors
`Retry-After` on 429 responses.

## Place coordinates

Place resources may include coordinates. They describe the place mentioned in
the saved item, not necessarily the user's capture location.

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

The standalone schema is `specs/schemas/orbit-resource.schema.json`. Saved
items and evidence records both reference it.
