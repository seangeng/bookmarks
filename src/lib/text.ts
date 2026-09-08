/** Text helpers shared by the pipeline scripts and the site. Keep dependency-free. */

const STOP_WORDS = new Set([
  "a", "about", "after", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "but", "by", "can", "come", "could", "did", "do", "does",
  "for", "from", "get", "got", "had", "has", "have", "he", "her", "here", "him",
  "his", "how", "i", "if", "in", "into", "is", "it", "its", "just", "like", "make",
  "me", "more", "most", "my", "no", "not", "now", "of", "on", "one", "only", "or",
  "other", "our", "out", "over", "own", "she", "should", "so", "some", "such",
  "than", "that", "the", "their", "them", "then", "there", "these", "they", "this",
  "those", "to", "too", "up", "us", "very", "via", "was", "we", "were", "what",
  "when", "which", "while", "who", "why", "will", "with", "would", "you", "your",
]);

export function tokenize(input: string): string[] {
  const raw = input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((token) => token.length > 1 && token.length < 32);

  // Keep compounds whole *and* split them, so a search for "zero knowledge"
  // still finds "zero-knowledge" (and vice versa).
  const tokens: string[] = [];
  for (const token of raw) {
    if (!STOP_WORDS.has(token)) tokens.push(token);
    if (!token.includes("-")) continue;
    for (const part of token.split("-")) {
      if (part.length > 1 && !STOP_WORDS.has(part)) tokens.push(part);
    }
  }
  return tokens;
}

/**
 * Light suffix folding so "embeddings" and "embedding" collide.
 *
 * Plural stripping runs before verb-suffix stripping, which is what makes this
 * idempotent: a single ordered pass would fold "embeddings" to "embedding" and
 * "embedding" to "embedd", so the two would never meet.
 */
export function stem(token: string): string {
  let word = token;

  if (word.length > 4) {
    if (word.endsWith("ies") && word.length > 5) word = `${word.slice(0, -3)}y`;
    else if (word.endsWith("sses")) word = word.slice(0, -2);
    else if (word.endsWith("es") && word.length > 5) word = word.slice(0, -2);
    else if (word.endsWith("s") && !word.endsWith("ss")) word = word.slice(0, -1);
  }

  if (word.length > 5) {
    for (const suffix of ["ingly", "edly", "ing", "ed"]) {
      if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
        word = word.slice(0, -suffix.length);
        break;
      }
    }
  }

  return word;
}

export function terms(input: string): string[] {
  return tokenize(input).map(stem);
}

/** Shorteners whose URLs carry no content of their own, only a redirect. */
export const SHORTENER_HOSTS = new Set([
  "t.co", "bit.ly", "buff.ly", "lnkd.in", "ow.ly", "tinyurl.com", "dlvr.it",
  "trib.al", "goo.gl", "ift.tt", "j.mp", "rebrand.ly", "shorturl.at",
]);

export function isShortenerUrl(url: string): boolean {
  try {
    return SHORTENER_HOSTS.has(new URL(url).hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/**
 * Removes shortener URLs from text meant for display. An unexpanded t.co link
 * is unreadable and unclickable-to-anywhere-useful, and X puts one in almost
 * every post — 96% of this library's posts contain at least one. The raw text
 * is preserved in the seed and the index; this only affects rendering.
 */
export function stripShortenerUrls(text: string): string {
  return collapseWhitespace(
    text.replace(/https?:\/\/\S+/g, (match) => (isShortenerUrl(match) ? " " : match)),
  );
}

/** What to render as a post's body, and whether it turned out to have none. */
export function postBody(text: string, summary = ""): { body: string; linkOnly: boolean } {
  const stripped = stripShortenerUrls(text);
  if (stripped.length >= 12) return { body: stripped, linkOnly: false };

  const fallback = collapseWhitespace(summary);
  if (fallback.length >= 12) return { body: fallback, linkOnly: false };

  return { body: stripped || fallback, linkOnly: true };
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Strips tracking junk and fragments so the same page hashes to one crawl key. */
export function normalizeUrl(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate) return null;
  // Add a scheme only when there is none at all, so "mailto:x@y.com" stays a
  // mailto (and is rejected below) instead of becoming "https://mailto:...".
  if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    // Tracking params only. `s`/`t` are deliberately left alone: X uses them,
    // but so do WordPress search URLs, where dropping them changes the page.
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref_)/i.test(key) || /^(ref|fbclid|gclid|mc_cid|mc_eid|igshid|si)$/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function truncate(input: string, max: number): string {
  const clean = collapseWhitespace(input);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`;
}

/**
 * Picks the window of text that best covers the query terms, so search results
 * show the part of a bookmark that actually matched.
 */
export function snippetFor(source: string, query: string, size = 240): string {
  const text = collapseWhitespace(source);
  if (!text) return "";
  const queryTerms = new Set(terms(query));
  if (queryTerms.size === 0) return truncate(text, size);

  const words = text.split(" ");
  const hits = words.map((word) => (queryTerms.has(stem(tokenize(word)[0] ?? "")) ? 1 : 0));
  const windowWords = Math.max(12, Math.round(size / 6));

  let best = 0;
  let bestScore = -1;
  for (let start = 0; start < Math.max(1, words.length - windowWords + 1); start += 3) {
    let score = 0;
    for (let i = start; i < Math.min(words.length, start + windowWords); i += 1) {
      score += hits[i];
    }
    if (score > bestScore) {
      bestScore = score;
      best = start;
    }
  }
  if (bestScore <= 0) return truncate(text, size);

  const slice = words.slice(best, best + windowWords).join(" ");
  const prefix = best > 0 ? "…" : "";
  const suffix = best + windowWords < words.length ? "…" : "";
  return `${prefix}${truncate(slice, size)}${suffix}`.replace(/……/g, "…");
}

/** Splits text into `{ text, match }` runs for <mark> rendering. */
export function highlightRuns(
  source: string,
  query: string,
): { text: string; match: boolean }[] {
  const queryTerms = new Set(terms(query));
  if (queryTerms.size === 0 || !source) return [{ text: source, match: false }];

  const runs: { text: string; match: boolean }[] = [];
  const pattern = /[\p{L}\p{N}][\p{L}\p{N}'+#.-]*/gu;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    const word = match[0];
    const isMatch = queryTerms.has(stem(word.toLowerCase()));
    if (!isMatch) continue;
    if (index > cursor) runs.push({ text: source.slice(cursor, index), match: false });
    runs.push({ text: word, match: true });
    cursor = index + word.length;
  }
  if (cursor < source.length) runs.push({ text: source.slice(cursor), match: false });
  return runs.length > 0 ? runs : [{ text: source, match: false }];
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function relativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diff = Date.now() - date.getTime();
  const day = 86_400_000;
  if (diff < day) return "today";
  if (diff < 2 * day) return "yesterday";
  if (diff < 30 * day) return `${Math.round(diff / day)}d ago`;
  if (diff < 365 * day) return `${Math.round(diff / (30 * day))}mo ago`;
  return `${Math.round(diff / (365 * day))}y ago`;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}
