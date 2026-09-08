import path from "node:path";

import { CRAWL_DIR, readJson, writeJson } from "./fs-data";
import { USER_AGENT } from "./crawler";
import { normalizeUrl } from "../../src/lib/text";

/**
 * Resolves link-shortener URLs to their destinations.
 *
 * Most of this library's posts are "look at this" plus a t.co link that the
 * export never expanded, so without resolution the majority of bookmarks have
 * nothing to crawl, nothing to classify, and nothing to search.
 *
 * This is opt-in (`npm run crawl -- --expand-short-links`) and off by default,
 * because t.co's robots.txt disallows every agent but Twitterbot. Only the
 * redirect is requested — never the shortener's body — and the destination is
 * then crawled through the normal path, with its own robots check. The clean
 * fix is upstream: have the export include `entities.urls[].expanded_url`,
 * which the X API already provides, and none of this is needed.
 */

export const SHORT_LINK_FILE = path.join(CRAWL_DIR, "short-links.json");

export type ShortLinkResolution = {
  url: string | null;
  status: "resolved" | "dead" | "error" | "loop";
  http_status?: number;
  error?: string;
  resolved_at: string;
};

export type ShortLinkMap = Record<string, ShortLinkResolution>;

const MAX_HOPS = 4;

export async function loadShortLinks(): Promise<ShortLinkMap> {
  return (await readJson<ShortLinkMap>(SHORT_LINK_FILE)) ?? {};
}

export async function saveShortLinks(map: ShortLinkMap): Promise<void> {
  const sorted = Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)));
  await writeJson(SHORT_LINK_FILE, sorted);
}

/** Follows redirects by header only, so no destination body is downloaded. */
async function resolveOne(shortUrl: string, timeoutMs: number): Promise<ShortLinkResolution> {
  const resolved_at = new Date().toISOString();
  const seen = new Set<string>();
  let current = shortUrl;

  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    if (seen.has(current)) {
      return { url: null, status: "loop", error: "Redirect loop", resolved_at };
    }
    seen.add(current);

    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": USER_AGENT, accept: "*/*" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return {
        url: null,
        status: "error",
        error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
        resolved_at,
      };
    }

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      const next = normalizeUrl(new URL(location, current).toString());
      if (!next) {
        return {
          url: null,
          status: "error",
          http_status: response.status,
          error: `Unusable redirect target: ${location.slice(0, 120)}`,
          resolved_at,
        };
      }
      current = next;
      continue;
    }

    // Landed on something that is not a redirect.
    if (current !== shortUrl) {
      return { url: current, status: "resolved", http_status: response.status, resolved_at };
    }
    return {
      url: null,
      status: response.ok ? "error" : "dead",
      http_status: response.status,
      error: response.ok
        ? "Shortener did not redirect"
        : `HTTP ${response.status} ${response.statusText}`.trim(),
      resolved_at,
    };
  }

  return { url: current, status: "resolved", resolved_at };
}

export async function resolveShortLinks(
  shortUrls: string[],
  {
    concurrency = 4,
    timeoutMs = 10_000,
    onResult,
  }: {
    concurrency?: number;
    timeoutMs?: number;
    onResult?: (shortUrl: string, result: ShortLinkResolution, done: number, total: number) => void;
  } = {},
): Promise<ShortLinkMap> {
  const map: ShortLinkMap = {};
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < shortUrls.length) {
      const index = cursor;
      cursor += 1;
      const shortUrl = shortUrls[index];
      const result = await resolveOne(shortUrl, timeoutMs);
      map[shortUrl] = result;
      done += 1;
      onResult?.(shortUrl, result, done, shortUrls.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, shortUrls.length)) }, worker),
  );
  return map;
}

/** Destination URLs for a bookmark's shorteners, skipping unresolved ones. */
export function resolvedDestinations(shortUrls: string[], map: ShortLinkMap): string[] {
  const out: string[] = [];
  for (const shortUrl of shortUrls) {
    const hit = map[shortUrl];
    if (hit?.url) out.push(hit.url);
  }
  return out;
}
