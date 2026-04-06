/**
 * MinHash implementation for fuzzy content similarity detection.
 *
 * Uses word-level trigram shingling with k=128 hash functions.
 * Pure TypeScript — no native dependencies.
 */

/** Number of hash functions in the MinHash signature */
export const MINHASH_K = 128;

/** Shingle size (word n-grams) */
const SHINGLE_SIZE = 3;

/** Large prime for hash function family */
const PRIME = 2147483647; // 2^31 - 1 (Mersenne prime)

/** Pre-generated random coefficients for hash functions: [a, b] pairs */
let hashCoefficients: Array<[number, number]> | undefined;

function getHashCoefficients(): Array<[number, number]> {
  if (hashCoefficients) {
    return hashCoefficients;
  }

  // Deterministic seed-based generation so signatures are reproducible
  hashCoefficients = [];
  let seed = 42;
  for (let i = 0; i < MINHASH_K; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const a = (seed % (PRIME - 1)) + 1;
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const b = seed % PRIME;
    hashCoefficients.push([a, b]);
  }

  return hashCoefficients;
}

/**
 * Compute a MinHash signature for a piece of text content.
 *
 * @param content - The rule body text (frontmatter should already be stripped)
 * @returns Array of k uint32 hash values forming the signature
 */
export function computeMinHash(content: string): number[] {
  const normalized = normalizeText(content);
  const shingles = generateShingles(normalized);
  const coefficients = getHashCoefficients();

  if (shingles.size === 0) {
    // Empty content — return all-max signature
    return new Array(MINHASH_K).fill(PRIME);
  }

  // For each hash function, find the minimum hash across all shingles
  const signature = new Array<number>(MINHASH_K).fill(PRIME);

  for (const shingleHash of shingles) {
    for (let i = 0; i < MINHASH_K; i++) {
      const [a, b] = coefficients[i];
      const hash = ((a * shingleHash + b) % PRIME) >>> 0;
      if (hash < signature[i]) {
        signature[i] = hash;
      }
    }
  }

  return signature;
}

/**
 * Compute approximate Jaccard similarity between two MinHash signatures.
 */
export function computeSimilarity(sigA: number[], sigB: number[]): number {
  if (sigA.length !== sigB.length || sigA.length === 0) {
    return 0;
  }

  let matches = 0;
  for (let i = 0; i < sigA.length; i++) {
    if (sigA[i] === sigB[i]) {
      matches++;
    }
  }

  return matches / sigA.length;
}

/** Normalize text for consistent hashing */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
    .replace(/\s+/g, ' ') // Collapse whitespace
    .trim();
}

/** Generate word-level trigram shingles and return their hashes */
function generateShingles(text: string): Set<number> {
  const words = text.split(' ').filter((w) => w.length > 0);
  const shingles = new Set<number>();

  if (words.length < SHINGLE_SIZE) {
    // For very short content, use the whole thing as one shingle
    if (words.length > 0) {
      shingles.add(hashString(words.join(' ')));
    }
    return shingles;
  }

  for (let i = 0; i <= words.length - SHINGLE_SIZE; i++) {
    const shingle = words.slice(i, i + SHINGLE_SIZE).join(' ');
    shingles.add(hashString(shingle));
  }

  return shingles;
}

/** Simple string hash (FNV-1a 32-bit) */
function hashString(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}
