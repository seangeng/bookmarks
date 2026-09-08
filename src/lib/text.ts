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
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9+#.\-\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[.\-]+|[.\-]+$/g, ""))
    .filter((token) => token.length > 1 && token.length < 32)
    .filter((token) => !STOP_WORDS.has(token));
}

/** Light suffix folding so "embeddings" and "embedding" collide. */
export function stem(token: string): string {
  if (token.length < 5) return token;
  for (const suffix of ["ingly", "edly", "ing", "ies", "ed", "es", "s"]) {
    if (token.endsWith(suffix) && token.length - suffix.length >= 3) {
      const base = token.slice(0, token.length - suffix.length);
      return suffix === "ies" ? `${base}y` : base;
    }
  }
  return token;
}

export function terms(input: string): string[] {
  return tokenize(input).map(stem);
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
  if (!/^https?:\/\//i.test(candidate)) candidate = `https://${candidate}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|ref_|fbclid|gclid|mc_cid|mc_eid|igshid|si|s|t)$/i.test(key)) {
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
