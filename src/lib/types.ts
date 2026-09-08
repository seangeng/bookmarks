import { z } from "zod";

/**
 * Canonical data model.
 *
 * `Bookmark` is the raw shape stored in `data/bookmarks-seed.json` — it is what
 * the X export pipeline produces. `IndexedBookmark` is the enriched read model
 * produced by `npm run index`, which is what the site actually renders.
 */

export const AuthorSchema = z.object({
  name: z.string(),
  handle: z.string(),
  avatar_url: z.string().optional(),
});

export const BookmarkSchema = z.object({
  /** X post id (snowflake), unique per bookmark. */
  id: z.string().min(1),
  text: z.string().default(""),
  author: AuthorSchema,
  /** Canonical post URL, e.g. https://x.com/handle/status/123 */
  url: z.string(),
  /** ISO 8601 timestamp of when the post was created. */
  created_at: z.string(),
  /** ISO 8601 timestamp of when it was bookmarked, when the export provides it. */
  bookmarked_at: z.string().optional(),
  /** Outbound links found in the post, already expanded by the export. */
  external_urls: z.array(z.string()).default([]),
  /**
   * Link-shortener URLs (t.co, bit.ly, …) the export did not expand. Kept
   * separate because a shortener is not itself crawlable content, and t.co's
   * robots.txt disallows everyone but Twitterbot — resolving these is opt-in.
   */
  short_urls: z.array(z.string()).default([]),
  /** Topics from the export. The index script treats these as authoritative hints. */
  topics: z.array(z.string()).default([]),
  media: z
    .array(z.object({ type: z.string(), url: z.string() }))
    .default([])
    .optional(),
  metrics: z
    .object({
      likes: z.number().optional(),
      reposts: z.number().optional(),
      replies: z.number().optional(),
    })
    .optional(),
});

export type Author = z.infer<typeof AuthorSchema>;
export type Bookmark = z.infer<typeof BookmarkSchema>;

export const CRAWL_STATUSES = [
  "ok",
  "empty",
  "unsupported_type",
  "http_error",
  "network_error",
  "timeout",
  "blocked_by_robots",
  "skipped",
] as const;

export type CrawlStatus = (typeof CRAWL_STATUSES)[number];

export const CrawlRecordSchema = z.object({
  /** sha1 of the normalized URL — also the artifact filename. */
  key: z.string(),
  url: z.string(),
  final_url: z.string().optional(),
  status: z.enum(CRAWL_STATUSES),
  http_status: z.number().optional(),
  content_type: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  site_name: z.string().optional(),
  byline: z.string().optional(),
  published_at: z.string().optional(),
  /** Main article text, trimmed to ~5k chars. */
  text: z.string().optional(),
  word_count: z.number().optional(),
  fetched_at: z.string(),
  duration_ms: z.number(),
  error: z.string().optional(),
});

export type CrawlRecord = z.infer<typeof CrawlRecordSchema>;

/**
 * The unit of the library.
 *
 * Bookmarks are only the *source* of URLs — the rendered library is the set of
 * unique external sites behind them. Nothing from X survives into this shape:
 * no post text, no author, no post URL, no `t.co`. A post with no external
 * link produces no entry, and a post with three links produces three.
 */
export type LibraryLink = {
  /** Stable id derived from the canonical URL. */
  id: string;
  url: string;
  domain: string;
  /** Crawled page title, or a readable fallback derived from the URL. */
  title: string;
  description?: string;
  site_name?: string;
  /** Trimmed body text from the crawl, shown on the detail page. */
  excerpt?: string;
  word_count: number;
  published_at?: string;
  /** Crawl outcome, so unreachable pages stay visible instead of vanishing. */
  status: CrawlStatus | "not_crawled";
  http_status?: number;
  error?: string;
  fetched_at?: string;
  /** Earliest date this URL was bookmarked. */
  saved_at: string;
  /** How many bookmarks pointed at this URL. */
  saves: number;
  topics: string[];
  topic_scores: Record<string, number>;
  /** Title + description + crawl body + domain + topics. Feeds keyword search. */
  search_text: string;
  /** Nearest neighbours by embedding distance, computed at index time. */
  related: string[];
};

export type EmbeddingProviderName = "openai" | "local";
export type VectorStoreName = "upstash" | "local";

export type IndexMeta = {
  generated_at: string;
  /** Entries in the rendered library: unique external URLs. */
  link_count: number;
  /** Bookmarks in the source export, including those with no external link. */
  source_bookmark_count: number;
  crawled_link_count: number;
  embedding: {
    provider: EmbeddingProviderName;
    model: string;
    dimensions: number;
  };
  vector_store: VectorStoreName;
  classifier: "llm" | "heuristic";
  topics: { slug: string; count: number }[];
};

export type StoredVectors = {
  dimensions: number;
  provider: EmbeddingProviderName;
  model: string;
  vectors: Record<string, number[]>;
};
