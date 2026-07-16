import { stableHash, tokenize } from "./utils.js";

export interface OrbitEmbeddingProvider {
  model: string;
  dimensions: number;
  embed(text: string): Promise<number[]>;
}
export function normalizeVector(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

export function cosineSimilarity(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftMagnitude += left[index] * left[index];
    rightMagnitude += right[index] * right[index];
  }
  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator === 0 ? 0 : dot / denominator;
}

export function keywordScore(query: string, text: string): number {
  const queryTerms = new Set(tokenize(query));
  if (queryTerms.size === 0) return 0;
  const textTerms = new Set(tokenize(text));
  let hits = 0;
  for (const term of queryTerms) {
    if (textTerms.has(term)) hits += 1;
  }
  return hits / queryTerms.size;
}

export function createDeterministicEmbeddingProvider(options?: {
  model?: string;
  dimensions?: number;
}): OrbitEmbeddingProvider {
  const dimensions = options?.dimensions ?? 384;
  const model = options?.model ?? "orbit/dev-hash-embedding-v0";

  return {
    model,
    dimensions,
    async embed(text: string): Promise<number[]> {
      const vector = new Array<number>(dimensions).fill(0);
      const terms = tokenize(text);
      for (const term of terms) {
        const hash = stableHash(term);
        const index = hash % dimensions;
        const sign = hash % 2 === 0 ? 1 : -1;
        vector[index] += sign * (1 + Math.min(term.length, 12) / 12);
      }
      return normalizeVector(vector);
    },
  };
}
