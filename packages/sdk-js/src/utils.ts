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

let wordSegmenter: Intl.Segmenter | null | undefined;

function segmenter(): Intl.Segmenter | null {
  if (wordSegmenter === undefined) {
    wordSegmenter =
      typeof Intl !== "undefined" && "Segmenter" in Intl
        ? new Intl.Segmenter(undefined, { granularity: "word" })
        : null;
  }
  return wordSegmenter;
}

export function tokenize(value: string): string[] {
  const lower = value.toLowerCase();
  const wordLike = segmenter();
  if (!wordLike) {
    return lower
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((term) => isSearchTerm(term));
  }
  const terms: string[] = [];
  for (const part of wordLike.segment(lower)) {
    if (!part.isWordLike) continue;
    const term = part.segment.trim();
    if (isSearchTerm(term)) terms.push(term);
  }
  return terms;
}

// Short ASCII terms are stop-word noise, but short non-ASCII terms (CJK
// words are often one or two characters) carry meaning and must be kept.
function isSearchTerm(term: string): boolean {
  if (!term) return false;
  return term.length > 2 || /[^\x00-\x7F]/.test(term);
}

export function chunkText(value: string, maxLength = 1400): string[] {
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + maxLength, clean.length);
    if (end < clean.length) {
      const lastSpace = clean.lastIndexOf(" ", end);
      if (lastSpace > start + Math.floor(maxLength / 2)) end = lastSpace;
    }
    chunks.push(clean.slice(start, end).trim());
    start = end;
    while (clean[start] === " ") start += 1;
  }
  return chunks;
}
