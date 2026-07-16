import type { OrbitId } from "./types.js";

export function nowIso(): string {
  return new Date().toISOString();
}
export function createOrbitId(prefix: string): OrbitId {
  const randomId = globalThis.crypto?.randomUUID?.();
  if (randomId) return `${prefix}_${randomId}`;
  const fallback = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${fallback}`;
}

export function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    const clean = value?.trim();
    if (clean) seen.add(clean);
  }
  return [...seen];
}

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((term) => term.length > 2);
}

export function chunkText(value: string, maxLength = 1400): string[] {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  for (let start = 0; start < clean.length; start += maxLength) {
    chunks.push(clean.slice(start, start + maxLength));
  }
  return chunks;
}
