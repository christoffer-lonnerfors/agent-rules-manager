/**
 * Approximate token estimation from character length.
 *
 * Uses a character-to-token ratio tuned for English prose + markdown,
 * which is the typical content of AI agent rule files.
 *
 * Rationale for the ratio:
 *   - GPT / Claude tokenisers (cl100k_base, o200k_base) average ~3.5–4
 *     characters per token on English text.
 *   - Markdown-heavy content with headings, bullets, and code snippets
 *     trends slightly lower (~3.5 chars/token) because of short tokens
 *     like `#`, `-`, `` ` ``, newlines.
 *   - We use 3.5 as the divisor so estimates lean slightly *high*,
 *     which is the safer direction (better to warn "this is large"
 *     a bit early than too late).
 *
 * The result is labelled "≈" in the UI so users know it's approximate.
 */
const CHARS_PER_TOKEN = 3.5;

/**
 * Estimate the number of tokens from a character count.
 * Returns an integer ≥ 0.
 */
export function estimateTokens(charCount: number): number {
  if (charCount <= 0) { return 0; }
  return Math.ceil(charCount / CHARS_PER_TOKEN);
}

/**
 * Format a token count for display.
 * - Under 1000: "≈ 450 tokens"
 * - 1000+: "≈ 1.2k tokens"
 */
export function formatTokenCount(tokens: number): string {
  if (tokens < 1000) {
    return `≈ ${tokens} tokens`;
  }
  const k = tokens / 1000;
  // Show one decimal place, but drop ".0"
  const formatted = k % 1 === 0 ? k.toFixed(0) : k.toFixed(1);
  return `≈ ${formatted}k tokens`;
}

