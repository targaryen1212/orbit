import type {
  CreateOrbitMemoryInput,
  OrbitEvidenceChunk,
  OrbitEvidenceKind,
  OrbitEvidenceSearchInput,
  OrbitMemoryObject,
  OrbitSearchHit,
  OrbitStore,
  OrbitUserMemory,
} from "./types.js";
import type { OrbitEmbeddingProvider } from "./embeddings.js";
import { cosineSimilarity, keywordScore } from "./embeddings.js";
import { chunkText, createOrbitId, nowIso, stableHash, uniqueStrings } from "./utils.js";

interface LocalOrbitStoreOptions {
  embeddingProvider?: OrbitEmbeddingProvider;
}

type MemoryBucket<T> = Map<string, Map<string, T>>;

export class LocalOrbitStore implements OrbitStore {
  private readonly memories: MemoryBucket<OrbitMemoryObject> = new Map();
  private readonly evidenceChunks: MemoryBucket<OrbitEvidenceChunk> = new Map();
  private readonly userMemories: MemoryBucket<OrbitUserMemory> = new Map();
  private readonly embeddingProvider?: OrbitEmbeddingProvider;

  constructor(options: LocalOrbitStoreOptions = {}) {
    this.embeddingProvider = options.embeddingProvider;
  }

  async putMemory(input: CreateOrbitMemoryInput | OrbitMemoryObject): Promise<OrbitMemoryObject> {
    const now = nowIso();
    const memory: OrbitMemoryObject = {
      schemaVersion: "orbit.memory.v0",
      id: input.id ?? createOrbitId("mem"),
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

    this.bucket(this.memories, memory.ownerId).set(memory.id, memory);
    return memory;
  }

  async getMemory(memoryId: string, ownerId: string): Promise<OrbitMemoryObject | null> {
    return this.bucket(this.memories, ownerId).get(memoryId) ?? null;
  }

  async listMemories(ownerId: string, options: { limit?: number } = {}): Promise<OrbitMemoryObject[]> {
    const limit = options.limit ?? 50;
    return [...this.bucket(this.memories, ownerId).values()]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async indexMemory(memoryId: string, ownerId: string): Promise<OrbitEvidenceChunk[]> {
    const memory = await this.getMemory(memoryId, ownerId);
    if (!memory) throw new Error(`Memory not found: ${memoryId}`);
    const chunks = await buildEvidenceChunks(memory, this.embeddingProvider);
    return this.putEvidenceChunks(chunks);
  }

  async putEvidenceChunks(chunks: OrbitEvidenceChunk[]): Promise<OrbitEvidenceChunk[]> {
    const written: OrbitEvidenceChunk[] = [];
    for (const chunk of chunks) {
      const next = { ...chunk };
      if (!next.embedding && this.embeddingProvider) {
        const vector = await this.embeddingProvider.embed(next.text);
        next.embedding = {
          model: this.embeddingProvider.model,
          dimensions: this.embeddingProvider.dimensions,
          vector,
          normalized: true,
        };
      }
      this.bucket(this.evidenceChunks, next.ownerId).set(next.id, next);
      written.push(next);
    }
    return written;
  }

  async searchEvidence(input: OrbitEvidenceSearchInput): Promise<Array<OrbitSearchHit<OrbitEvidenceChunk>>> {
    const limit = input.limit ?? 10;
    const queryVector = this.embeddingProvider ? await this.embeddingProvider.embed(input.query) : null;
    const memorySourceType = await this.sourceTypeLookup(input.ownerId);

    const hits = [...this.bucket(this.evidenceChunks, input.ownerId).values()]
      .filter((chunk) => this.matchesFilters(chunk, input, memorySourceType))
      .map((chunk) => {
        const semanticScore = this.semanticScore(queryVector, chunk);
        const keyword = keywordScore(input.query, [
          chunk.text,
          ...(chunk.tags ?? []),
          ...Object.values(chunk.entities ?? {}).flat(),
        ].join(" "));
        const score = semanticScore > 0 ? semanticScore * 0.78 + keyword * 0.22 : keyword;
        const item = input.includeVectors ? chunk : stripVector(chunk);
        return { item, score, semanticScore, keywordScore: keyword };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);

    return hits;
  }

  async upsertUserMemory(
    input: Omit<OrbitUserMemory, "schemaVersion" | "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    }
  ): Promise<OrbitUserMemory> {
    const now = nowIso();
    const memory: OrbitUserMemory = {
      schemaVersion: "orbit.user_memory.v0",
      id: input.id ?? createOrbitId("usrmem"),
      ownerId: input.ownerId,
      content: input.content,
      source: input.source,
      confidence: input.confidence,
      status: input.status ?? "active",
      metadata: input.metadata,
      createdAt: input.createdAt ?? now,
      updatedAt: now,
    };
    this.bucket(this.userMemories, input.ownerId).set(memory.id, memory);
    return memory;
  }

  async listUserMemories(ownerId: string, options: { limit?: number } = {}): Promise<OrbitUserMemory[]> {
    const limit = options.limit ?? 50;
    return [...this.bucket(this.userMemories, ownerId).values()]
      .filter((memory) => memory.status !== "deleted")
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
  }

  async deleteUserMemory(memoryId: string, ownerId: string): Promise<boolean> {
    return this.bucket(this.userMemories, ownerId).delete(memoryId);
  }

  private bucket<T>(store: MemoryBucket<T>, ownerId: string): Map<string, T> {
    const existing = store.get(ownerId);
    if (existing) return existing;
    const next = new Map<string, T>();
    store.set(ownerId, next);
    return next;
  }

  private async sourceTypeLookup(ownerId: string): Promise<Map<string, string>> {
    const lookup = new Map<string, string>();
    for (const memory of await this.listMemories(ownerId, { limit: Number.MAX_SAFE_INTEGER })) {
      lookup.set(memory.id, memory.source.type);
    }
    return lookup;
  }

  private semanticScore(queryVector: number[] | null, chunk: OrbitEvidenceChunk): number {
    if (!queryVector || !chunk.embedding || !this.embeddingProvider) return 0;
    if (chunk.embedding.model !== this.embeddingProvider.model) return 0;
    if (chunk.embedding.dimensions !== this.embeddingProvider.dimensions) return 0;
    return Math.max(0, cosineSimilarity(queryVector, chunk.embedding.vector));
  }

  private matchesFilters(
    chunk: OrbitEvidenceChunk,
    input: OrbitEvidenceSearchInput,
    memorySourceType: Map<string, string>
  ): boolean {
    const filters = input.filters;
    if (!filters) return true;
    if (filters.memoryIds && !filters.memoryIds.includes(chunk.memoryId)) return false;
    if (filters.category && chunk.category !== filters.category) return false;
    if (filters.createdAfter && chunk.memoryCreatedAt && chunk.memoryCreatedAt < filters.createdAfter) return false;
    if (filters.createdBefore && chunk.memoryCreatedAt && chunk.memoryCreatedAt > filters.createdBefore) return false;
    if (filters.sourceTypes && !filters.sourceTypes.includes(memorySourceType.get(chunk.memoryId) as never)) return false;
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
  memory: OrbitMemoryObject,
  embeddingProvider?: OrbitEmbeddingProvider
): Promise<OrbitEvidenceChunk[]> {
  const rawChunks: Array<{
    kind: OrbitEvidenceKind;
    text: string;
    sourceFields: string[];
  }> = [];

  addRawChunk(rawChunks, "summary", [memory.title, memory.summary].filter(Boolean).join("\n"), ["title", "summary"]);
  addRawChunk(rawChunks, "note", memory.note ?? "", ["note"]);
  addRawChunk(rawChunks, "body", memory.content?.text ?? memory.source.text ?? "", ["content.text", "source.text"]);
  addRawChunk(rawChunks, "caption", memory.content?.caption ?? "", ["content.caption"]);

  for (const [index, part] of chunkText(memory.content?.transcript ?? "").entries()) {
    addRawChunk(rawChunks, "transcript", `Transcript part ${index + 1}: ${part}`, ["content.transcript"]);
  }

  if (memory.resources && memory.resources.length > 0) {
    addRawChunk(
      rawChunks,
      "resource",
      memory.resources.map((resource) => {
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

  if (memory.entities) {
    addRawChunk(
      rawChunks,
      "entity",
      Object.entries(memory.entities)
        .filter(([, values]) => values && values.length > 0)
        .map(([type, values]) => `${type}: ${values?.join(", ")}`)
        .join("\n"),
      ["entities"]
    );
  }

  const chunks: OrbitEvidenceChunk[] = [];
  for (const raw of rawChunks) {
    if (isRedactedSource(raw.sourceFields, memory.privacy?.redaction)) continue;

    const clean = raw.text.replace(/\s+/g, " ").trim().slice(0, 1800);
    const chunk: OrbitEvidenceChunk = {
      schemaVersion: "orbit.evidence.v0",
      id: `chunk_${memory.id}_${raw.kind}_${stableHash(clean).toString(36)}`,
      ownerId: memory.ownerId,
      memoryId: memory.id,
      kind: raw.kind,
      text: clean,
      sourceFields: raw.sourceFields,
      category: typeof memory.metadata?.category === "string" ? memory.metadata.category : undefined,
      tags: memory.tags ?? [],
      entities: memory.entities,
      resources: memory.resources,
      createdAt: nowIso(),
      memoryCreatedAt: memory.createdAt,
    };

    if (embeddingProvider) {
      const vector = await embeddingProvider.embed(clean);
      chunk.embedding = {
        model: embeddingProvider.model,
        dimensions: embeddingProvider.dimensions,
        vector,
        normalized: true,
      };
    }
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

function stripVector(chunk: OrbitEvidenceChunk): OrbitEvidenceChunk {
  if (!chunk.embedding) return chunk;
  const { embedding: _embedding, ...rest } = chunk;
  return rest;
}
