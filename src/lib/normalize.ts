import { BookmarkSchema, type Bookmark } from "./types";
import { normalizeUrl } from "./text";

/**
 * Adapter between "whatever the X export produced" and our canonical Bookmark.
 *
 * The weekday export can arrive as a bare array, `{ bookmarks: [...] }`, or
 * `{ data: [...] }`, with fields in either snake_case or the shapes the X API
 * v2 returns. Normalizing here means a fresh export can be dropped straight
 * into `data/bookmarks-seed.json` without touching the site code.
 */

type Loose = Record<string, unknown>;

function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

function pick(source: Loose, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = str(source[key]);
    if (value) return value;
  }
  return undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toIso(value: unknown): string | undefined {
  const raw = str(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) return date.toISOString();
  // X sometimes emits "Wed Oct 10 20:19:24 +0000 2018".
  const legacy = new Date(raw.replace(/^\w{3} /, ""));
  return Number.isNaN(legacy.getTime()) ? undefined : legacy.toISOString();
}

function extractAuthor(record: Loose): { name: string; handle: string; avatar_url?: string } {
  const nested = (record.author ?? record.user ?? record.core ?? {}) as Loose;
  const handle =
    pick(nested, "handle", "screen_name", "username", "screenName") ??
    pick(record, "author_handle", "username", "screen_name") ??
    "unknown";
  const name =
    pick(nested, "name", "display_name", "displayName") ??
    pick(record, "author_name", "name") ??
    handle;
  const avatar =
    pick(nested, "avatar_url", "profile_image_url", "profile_image_url_https") ??
    pick(record, "avatar_url");
  return {
    name,
    handle: handle.replace(/^@/, ""),
    ...(avatar ? { avatar_url: avatar } : {}),
  };
}

function extractUrls(record: Loose, text: string): string[] {
  const found = new Set<string>();

  for (const value of asArray(record.external_urls ?? record.urls ?? record.links)) {
    const url = typeof value === "string" ? value : str((value as Loose)?.expanded_url);
    const normalized = url ? normalizeUrl(url) : null;
    if (normalized) found.add(normalized);
  }

  const entities = (record.entities ?? {}) as Loose;
  for (const value of asArray(entities.urls)) {
    const entity = value as Loose;
    const url =
      str(entity.expanded_url) ?? str(entity.unwound_url) ?? str(entity.url);
    const normalized = url ? normalizeUrl(url) : null;
    if (normalized) found.add(normalized);
  }

  for (const match of text.matchAll(/https?:\/\/[^\s<>"')]+/g)) {
    const normalized = normalizeUrl(match[0]);
    if (normalized) found.add(normalized);
  }

  // t.co shorteners carry no content; drop them unless nothing else survived.
  const expanded = [...found].filter((url) => !url.includes("t.co/"));
  const selfLinks = (url: string) => /(^|\/\/)(x|twitter)\.com\//.test(url);
  const external = expanded.filter((url) => !selfLinks(url));
  return external.length > 0 ? external : expanded.filter((url) => !selfLinks(url));
}

export function normalizeBookmark(input: unknown): Bookmark | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Loose;

  const id =
    pick(record, "id", "post_id", "tweet_id", "id_str", "rest_id") ??
    (typeof record.legacy === "object" ? pick(record.legacy as Loose, "id_str") : undefined);
  if (!id) return null;

  const legacy = (record.legacy ?? {}) as Loose;
  const text =
    pick(record, "text", "full_text", "note_tweet_text", "content") ??
    pick(legacy, "full_text", "text") ??
    "";

  const author = extractAuthor(record);
  const url =
    pick(record, "url", "post_url", "permalink", "tweet_url") ??
    `https://x.com/${author.handle}/status/${id}`;

  const createdAt =
    toIso(record.created_at ?? record.createdAt ?? legacy.created_at) ??
    toIso(record.bookmarked_at) ??
    new Date(0).toISOString();

  const topics = asArray(record.topics ?? record.tags)
    .map((value) => str(value))
    .filter((value): value is string => Boolean(value));

  const parsed = BookmarkSchema.safeParse({
    id,
    text,
    author,
    url,
    created_at: createdAt,
    bookmarked_at: toIso(record.bookmarked_at ?? record.saved_at),
    external_urls: extractUrls(record, text),
    topics,
    media: asArray(record.media)
      .map((value) => {
        const entry = value as Loose;
        const mediaUrl = str(entry.url) ?? str(entry.media_url_https);
        const type = str(entry.type) ?? "photo";
        return mediaUrl ? { type, url: mediaUrl } : null;
      })
      .filter((value): value is { type: string; url: string } => value !== null),
    metrics:
      typeof record.metrics === "object" && record.metrics !== null
        ? record.metrics
        : undefined,
  });

  return parsed.success ? parsed.data : null;
}

export type NormalizeResult = {
  bookmarks: Bookmark[];
  skipped: number;
};

export function normalizeExport(raw: unknown): NormalizeResult {
  const container = raw as Loose | unknown[] | null;
  const list = Array.isArray(container)
    ? container
    : asArray(
        (container as Loose)?.bookmarks ??
          (container as Loose)?.data ??
          (container as Loose)?.items,
      );

  const seen = new Set<string>();
  const bookmarks: Bookmark[] = [];
  let skipped = 0;

  for (const entry of list) {
    const bookmark = normalizeBookmark(entry);
    if (!bookmark) {
      skipped += 1;
      continue;
    }
    if (seen.has(bookmark.id)) continue;
    seen.add(bookmark.id);
    bookmarks.push(bookmark);
  }

  bookmarks.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return { bookmarks, skipped };
}
