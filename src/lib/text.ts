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

const X_HOSTS = new Set(["x.com", "twitter.com", "mobile.twitter.com", "pbs.twimg.com", "t.co"]);

/** X's own surfaces. This library is about the sites behind the bookmarks. */
export function isXUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return X_HOSTS.has(host) || host.endsWith(".twimg.com");
  } catch {
    return false;
  }
}

/**
 * True for URLs that can stand on their own as a library entry: an http(s)
 * address that is neither a shortener nor a link back into X. Most `t.co`
 * links unwrap to x.com rather than to a site, so this filter is applied to
 * resolved destinations too, not just to what the export handed us.
 */
export function isExternalContentUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isShortenerUrl(url) && !isXUrl(url);
  } catch {
    return false;
  }
}

/** Readable form of a URL for display: no scheme, no trailing slash. */
export function prettyUrl(url: string, max = 72): string {
  const clean = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return truncate(clean, max);
}

/**
 * Fallback title for a page the crawler could not read: the last meaningful
 * path segment, humanised, else the domain.
 */
export function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split("/").filter(Boolean).pop();
    if (!segment) return parsed.hostname.replace(/^www\./, "");
    const words = decodeURIComponent(segment)
      .replace(/\.(html?|php|aspx?|pdf|md)$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!words || /^\d+$/.test(words)) return parsed.hostname.replace(/^www\./, "");
    return words.replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return url;
  }
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
