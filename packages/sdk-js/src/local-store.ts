import type {
  CreateOrbitItemInput,
  OrbitEvidenceChunk,
  OrbitEvidenceKind,
  OrbitEvidenceSearchInput,
  OrbitItem,
  OrbitSearchHit,
  OrbitSourceType,
  OrbitStore,
  OrbitUserFact,
  UpdateOrbitItemRequest,
} from "./types.js";
import { chunkText, createOrbitId, nowIso, stableHash, tokenize, uniqueStrings } from "./utils.js";

type OwnerBucket<T> = Map<string, Map<string, T>>;

export class LocalOrbitStore implements OrbitStore {
  private readonly items: OwnerBucket<OrbitItem> = new Map();
  private readonly evidenceChunks: OwnerBucket<OrbitEvidenceChunk> = new Map();
  private readonly userFacts: OwnerBucket<OrbitUserFact> = new Map();

  async putItem(input: CreateOrbitItemInput | OrbitItem): Promise<OrbitItem> {
    const now = nowIso();
    const item: OrbitItem = {
      schemaVersion: "orbit.item.v0",
      id: input.id ?? createOrbitId("item"),
      ownerId: input.ownerId,
      title: input.title ?? null,
      summary: input.summary ?? null,
      note: input.note ?? null,
      source: input.source,
      content: input.content,
      tags: uniqueStrings(input.tags ?? []),
      entities: input.entities,
      resources: input.resources ?? [],
      privacy: input.privacy ?? { scope: "private" },
      status: input.status ?? "completed",
      metadata: input.metadata,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };

    this.bucket(this.items, item.ownerId).set(item.id, item);
    return item;
  }

  async getItem(itemId: string, ownerId: string): Promise<OrbitItem | null> {
    return this.bucket(this.items, ownerId).get(itemId) ?? null;
  }

  async listItems(ownerId: string, options: { limit?: number } = {}): Promise<OrbitItem[]> {
    const limit = options.limit ?? 50;
    return [...this.bucket(this.items, ownerId).values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async updateItem(itemId: string, ownerId: string, patch: UpdateOrbitItemRequest): Promise<OrbitItem | null> {
    const existing = await this.getItem(itemId, ownerId);
    if (!existing) return null;
    const updated: OrbitItem = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
      ...(patch.note !== undefined ? { note: patch.note } : {}),
      ...(patch.tags !== undefined ? { tags: uniqueStrings(patch.tags) } : {}),
      ...(patch.privacy !== undefined ? { privacy: patch.privacy } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
      updatedAt: nowIso(),
    };
    this.bucket(this.items, ownerId).set(itemId, updated);
    // Evidence derived from the old field values is stale (and may now be
    // redacted); drop it so the caller re-indexes from the updated item.
    this.deleteEvidenceForItem(itemId, ownerId);
    return updated;
  }

  async deleteItem(itemId: string, ownerId: string): Promise<boolean> {
    const removed = this.bucket(this.items, ownerId).delete(itemId);
    this.deleteEvidenceForItem(itemId, ownerId);
    return removed;
  }

  async indexItem(itemId: string, ownerId: string): Promise<OrbitEvidenceChunk[]> {
    const item = await this.getItem(itemId, ownerId);
    if (!item) throw new Error(`Item not found: ${itemId}`);
    const chunks = await buildEvidenceChunks(item);
    return this.putEvidenceChunks(chunks);
  }

  async putEvidenceChunks(chunks: OrbitEvidenceChunk[]): Promise<OrbitEvidenceChunk[]> {
    const written: OrbitEvidenceChunk[] = [];
    for (const chunk of chunks) {
      const next = { ...chunk };
      this.bucket(this.evidenceChunks, next.ownerId).set(next.id, next);
      written.push(next);
    }
    return written;
  }

  async searchEvidence(input: OrbitEvidenceSearchInput): Promise<Array<OrbitSearchHit<OrbitEvidenceChunk>>> {
    const limit = input.limit ?? 10;
    const itemSourceType = await this.sourceTypeLookup(input.ownerId);

    const hits = [...this.bucket(this.evidenceChunks, input.ownerId).values()]
      .filter((chunk) => this.matchesFilters(chunk, input, itemSourceType))
      .map((chunk) => {
        const keyword = keywordScore(input.query, [
          chunk.text,
          ...(chunk.tags ?? []),
          ...Object.values(chunk.entities ?? {}).flat(),
        ].join(" "));
        return { item: chunk, score: keyword, keywordScore: keyword };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return hits;
  }

  async upsertUserFact(
    input: Omit<OrbitUserFact, "schemaVersion" | "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    }
  ): Promise<OrbitUserFact> {
    const now = nowIso();
    const fact: OrbitUserFact = {
      schemaVersion: "orbit.user_fact.v0",
      id: input.id ?? createOrbitId("fact"),
      ownerId: input.ownerId,
      content: input.content,
      source: input.source,
      confidence: input.confidence,
      status: input.status ?? "active",
      metadata: input.metadata,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    this.bucket(this.userFacts, input.ownerId).set(fact.id, fact);
    return fact;
  }

  async listUserFacts(ownerId: string, options: { limit?: number } = {}): Promise<OrbitUserFact[]> {
    const limit = options.limit ?? 50;
    return [...this.bucket(this.userFacts, ownerId).values()]
      .filter((fact) => fact.status !== "deleted")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async deleteUserFact(factId: string, ownerId: string): Promise<boolean> {
    return this.bucket(this.userFacts, ownerId).delete(factId);
  }

  private deleteEvidenceForItem(itemId: string, ownerId: string): void {
    const chunks = this.bucket(this.evidenceChunks, ownerId);
    for (const [chunkId, chunk] of chunks) {
      if (chunk.itemId === itemId) chunks.delete(chunkId);
    }
  }

  private bucket<T>(store: OwnerBucket<T>, ownerId: string): Map<string, T> {
    const existing = store.get(ownerId);
    if (existing) return existing;
    const next = new Map<string, T>();
    store.set(ownerId, next);
    return next;
  }

  private async sourceTypeLookup(ownerId: string): Promise<Map<string, OrbitSourceType>> {
    const lookup = new Map<string, OrbitSourceType>();
    for (const item of await this.listItems(ownerId, { limit: Number.MAX_SAFE_INTEGER })) {
      lookup.set(item.id, item.source.type);
    }
    return lookup;
  }

  private matchesFilters(
    chunk: OrbitEvidenceChunk,
    input: OrbitEvidenceSearchInput,
    itemSourceType: Map<string, OrbitSourceType>
  ): boolean {
    const filters = input.filters;
    if (!filters) return true;
    if (filters.itemIds && !filters.itemIds.includes(chunk.itemId)) return false;
    if (filters.category && chunk.category !== filters.category) return false;
    if (filters.createdAfter && chunk.itemCreatedAt && chunk.itemCreatedAt < filters.createdAfter) return false;
    if (filters.createdBefore && chunk.itemCreatedAt && chunk.itemCreatedAt > filters.createdBefore) return false;
    if (filters.sourceTypes) {
      const sourceType = itemSourceType.get(chunk.itemId);
      if (!sourceType || !filters.sourceTypes.includes(sourceType)) return false;
    }
    if (filters.tags) {
      const chunkTags = new Set(chunk.tags ?? []);
      if (!filters.tags.every((tag) => chunkTags.has(tag))) return false;
    }
    if (filters.entities) {
      for (const [entityType, expectedValues] of Object.entries(filters.entities)) {
        if (!expectedValues || expectedValues.length === 0) continue;
        const actual = new Set((chunk.entities?.[entityType] ?? []).map((value) => value.toLowerCase()));
        const hasAll = expectedValues.every((value) => actual.has(value.toLowerCase()));
        if (!hasAll) return false;
      }
    }
    return true;
  }
}

export async function buildEvidenceChunks(
  item: OrbitItem
): Promise<OrbitEvidenceChunk[]> {
  const rawChunks: Array<{
    kind: OrbitEvidenceKind;
    text: string;
    sourceFields: string[];
  }> = [];

  addRawChunk(rawChunks, "summary", [item.title, item.summary].filter(Boolean).join("\n"), ["title", "summary"]);
  addRawChunk(rawChunks, "note", item.note ?? "", ["note"]);
  addRawChunk(rawChunks, "body", item.content?.text ?? item.source.text ?? "", ["content.text", "source.text"]);
  addRawChunk(rawChunks, "caption", item.content?.caption ?? "", ["content.caption"]);

  for (const [index, part] of chunkText(item.content?.transcript ?? "").entries()) {
    addRawChunk(rawChunks, "transcript", `Transcript part ${index + 1}: ${part}`, ["content.transcript"]);
  }

  if (item.resources && item.resources.length > 0) {
    addRawChunk(
      rawChunks,
      "resource",
      item.resources.map((resource) => {
        const geo = resource.geo ?
          `${resource.geo.latitude},${resource.geo.longitude}` :
          undefined;
        const address = resource.address?.label ?? [
          resource.address?.locality,
          resource.address?.region,
          resource.address?.country,
        ].filter(Boolean).join(", ");
        return [resource.name, resource.type, resource.searchQuery, address, geo]
          .filter(Boolean)
          .join(" - ");
      }).join("\n"),
      ["resources"]
    );
  }

  if (item.entities) {
    addRawChunk(
      rawChunks,
      "entity",
      Object.entries(item.entities)
        .filter(([, values]) => values && values.length > 0)
        .map(([type, values]) => `${type}: ${values?.join(", ")}`)
        .join("\n"),
      ["entities"]
    );
  }

  const chunks: OrbitEvidenceChunk[] = [];
  for (const raw of rawChunks) {
    if (isRedactedSource(raw.sourceFields, item.privacy?.redaction)) continue;

    const clean = raw.text.replace(/\s+/g, " ").trim().slice(0, 1800);
    const chunk: OrbitEvidenceChunk = {
      schemaVersion: "orbit.evidence.v0",
      id: `chunk_${item.id}_${raw.kind}_${stableHash(clean).toString(36)}`,
      ownerId: item.ownerId,
      itemId: item.id,
      kind: raw.kind,
      text: clean,
      sourceFields: raw.sourceFields,
      category: typeof item.metadata?.category === "string" ? item.metadata.category : undefined,
      tags: item.tags ?? [],
      entities: item.entities,
      resources: item.resources,
      createdAt: nowIso(),
      itemCreatedAt: item.createdAt,
    };

    chunks.push(chunk);
  }
  return chunks;
}

export function isRedactedSource(sourceFields: string[], redactions: string[] = []): boolean {
  return sourceFields.some((field) =>
    redactions.some((redaction) => {
      const clean = redaction.trim();
      if (!clean) return false;
      return field === clean || field.startsWith(`${clean}.`) || clean.startsWith(`${field}.`);
    })
  );
}

function addRawChunk(
  chunks: Array<{ kind: OrbitEvidenceKind; text: string; sourceFields: string[] }>,
  kind: OrbitEvidenceKind,
  text: string,
  sourceFields: string[]
): void {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length < 8) return;
  chunks.push({ kind, text: clean, sourceFields });
}

function keywordScore(query: string, text: string): number {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return 0;
  const textTerms = new Set(tokenize(text));
  let hits = 0;
  for (const term of queryTerms) {
    if (textTerms.has(term)) hits += 1;
  }
  return hits / queryTerms.size;
}
