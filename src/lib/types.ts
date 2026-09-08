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
  /** Outbound links found in the post (already unwrapped from t.co when possible). */
  external_urls: z.array(z.string()).default([]),
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

/** A post link plus whatever the crawler managed to learn about it. */
export type BookmarkLink = {
  url: string;
  domain: string;
  crawl?: {
    status: CrawlStatus;
    http_status?: number;
    title?: string;
    description?: string;
    site_name?: string;
    /** First ~600 chars of extracted body text, for cards and search snippets. */
    excerpt?: string;
    word_count?: number;
    fetched_at?: string;
    error?: string;
  };
};

export type IndexedBookmark = Bookmark & {
  topics: string[];
  topic_scores: Record<string, number>;
  links: BookmarkLink[];
  /** One-line gist used in cards: crawl description, else the post text. */
  summary: string;
  /** Concatenated post text + crawl content + topics. Feeds keyword search. */
  search_text: string;
  /** Nearest neighbours by embedding distance, computed at index time. */
  related: string[];
  crawled_words: number;
};

export type EmbeddingProviderName = "openai" | "local";
export type VectorStoreName = "upstash" | "local";

export type IndexMeta = {
  generated_at: string;
  bookmark_count: number;
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
