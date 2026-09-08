import { extractArticle } from "./extract";
import { urlKey } from "./fs-data";
import { domainOf } from "../../src/lib/text";
import type { CrawlRecord, CrawlStatus } from "../../src/lib/types";

export const USER_AGENT =
  "seangeng-bookmarks-crawler/1.0 (+https://bookmarks.seangeng.com; personal bookmark archiver)";

export type CrawlOptions = {
  timeoutMs: number;
  maxChars: number;
  maxBytes: number;
  respectRobots: boolean;
  /** Minimum gap between requests to the same host. */
  hostDelayMs: number;
};

export const DEFAULT_CRAWL_OPTIONS: CrawlOptions = {
  timeoutMs: 10_000,
  maxChars: 5_000,
  maxBytes: 2_500_000,
  respectRobots: true,
  hostDelayMs: 750,
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** ---------------------------------------------------------------- robots */

/** Our product token, i.e. the name a site would target in robots.txt. */
const AGENT_TOKEN = "seangeng-bookmarks-crawler";

type Rule = { allow: boolean; pattern: string };
type RobotsGroup = { agents: string[]; rules: Rule[]; crawlDelayMs?: number };
type Robots = { rules: Rule[]; crawlDelayMs?: number };

const robotsCache = new Map<string, Promise<Robots | null>>();

export function parseRobots(body: string): Robots {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let expectingAgents = false;

  for (const line of body.split(/\r?\n/)) {
    const clean = line.split("#")[0].trim();
    if (!clean) continue;
    const separator = clean.indexOf(":");
    if (separator < 0) continue;
    const field = clean.slice(0, separator).trim().toLowerCase();
    const value = clean.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group of rules.
      if (!current || !expectingAgents) {
        current = { agents: [], rules: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (!current) continue;
    expectingAgents = false;

    if (field === "disallow") {
      // "Disallow:" with no value means "allow everything" and carries no rule.
      if (value) current.rules.push({ allow: false, pattern: value });
    } else if (field === "allow") {
      if (value) current.rules.push({ allow: true, pattern: value });
    } else if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) current.crawlDelayMs = seconds * 1000;
    }
  }

  const named = groups.filter((group) =>
    group.agents.some((agent) => agent !== "*" && AGENT_TOKEN.includes(agent)),
  );
  const wildcard = groups.filter((group) => group.agents.includes("*"));
  const applicable = named.length > 0 ? named : wildcard;

  return {
    rules: applicable.flatMap((group) => group.rules),
    crawlDelayMs: applicable.find((group) => group.crawlDelayMs)?.crawlDelayMs,
  };
}

/** robots.txt globs: `*` matches any run of characters, trailing `$` anchors. */
function patternMatches(pattern: string, target: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(target);
}

/** Longest matching rule wins; Allow wins ties. No match means allowed. */
export function pathAllowed(robots: Robots, target: string): boolean {
  let decision = true;
  let bestLength = -1;

  for (const rule of robots.rules) {
    if (!patternMatches(rule.pattern, target)) continue;
    const length = rule.pattern.length;
    if (length > bestLength || (length === bestLength && rule.allow)) {
      bestLength = length;
      decision = rule.allow;
    }
  }
  return decision;
}

async function robotsFor(origin: string, timeoutMs: number): Promise<Robots | null> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const request = (async () => {
    try {
      const response = await fetch(`${origin}/robots.txt`, {
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(Math.min(timeoutMs, 5_000)),
      });
      // 4xx means "no restrictions"; 5xx conservatively means "stay out".
      if (response.status >= 500) return { rules: [{ allow: false, pattern: "/" }] };
      if (!response.ok) return null;
      return parseRobots((await response.text()).slice(0, 200_000));
    } catch {
      return null;
    }
  })();

  robotsCache.set(origin, request);
  return request;
}

/** --------------------------------------------------------------- fetching */

const lastHostRequest = new Map<string, number>();

async function throttleHost(host: string, delayMs: number): Promise<void> {
  const previous = lastHostRequest.get(host) ?? 0;
  const wait = previous + delayMs - Date.now();
  lastHostRequest.set(host, Date.now() + Math.max(0, wait));
  if (wait > 0) await sleep(wait);
}

function describeError(error: unknown): { status: CrawlStatus; message: string } {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || /timed? ?out|abort/i.test(message)) {
    return { status: "timeout", message: "Request timed out" };
  }
  return { status: "network_error", message: message.slice(0, 240) };
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const buffer = await response.arrayBuffer();
  const slice = buffer.byteLength > maxBytes ? buffer.slice(0, maxBytes) : buffer;
  return new TextDecoder("utf-8", { fatal: false }).decode(slice);
}

export async function crawlUrl(url: string, options: CrawlOptions): Promise<CrawlRecord> {
  const started = Date.now();
  const key = urlKey(url);
  const base = {
    key,
    url,
    fetched_at: new Date().toISOString(),
  };
  const finish = (record: Omit<CrawlRecord, "duration_ms">): CrawlRecord => ({
    ...record,
    duration_ms: Date.now() - started,
  });

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return finish({ ...base, status: "network_error", error: "Invalid URL" });
  }

  let hostDelayMs = options.hostDelayMs;
  if (options.respectRobots) {
    const robots = await robotsFor(parsed.origin, options.timeoutMs);
    if (robots && !pathAllowed(robots, `${parsed.pathname}${parsed.search}`)) {
      return finish({ ...base, status: "blocked_by_robots", error: "Disallowed by robots.txt" });
    }
    if (robots?.crawlDelayMs) {
      // Honour Crawl-delay, but cap it so one slow directive cannot stall a run.
      hostDelayMs = Math.max(hostDelayMs, Math.min(robots.crawlDelayMs, 5_000));
    }
  }

  await throttleHost(parsed.host, hostDelayMs);

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
  } catch (error) {
    const { status, message } = describeError(error);
    return finish({ ...base, status, error: message });
  }

  const contentType = response.headers.get("content-type") ?? undefined;
  const shared = {
    ...base,
    final_url: response.url !== url ? response.url : undefined,
    http_status: response.status,
    content_type: contentType,
  };

  if (!response.ok) {
    return finish({
      ...shared,
      status: "http_error",
      error: `HTTP ${response.status} ${response.statusText}`.trim(),
    });
  }

  if (contentType && !/text\/html|application\/xhtml|text\/plain|\+xml/i.test(contentType)) {
    return finish({
      ...shared,
      status: "unsupported_type",
      title: decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() ?? parsed.host),
      site_name: domainOf(url),
      error: `Skipped non-HTML content (${contentType.split(";")[0]})`,
    });
  }

  let html: string;
  try {
    html = await readCapped(response, options.maxBytes);
  } catch (error) {
    const { status, message } = describeError(error);
    return finish({ ...shared, status, error: message });
  }

  const extraction = extractArticle(html, { maxChars: options.maxChars });
  const hasContent = extraction.text.length > 120 || Boolean(extraction.description);

  return finish({
    ...shared,
    status: hasContent ? "ok" : "empty",
    title: extraction.title,
    description: extraction.description,
    site_name: extraction.site_name ?? domainOf(url),
    byline: extraction.byline,
    published_at: extraction.published_at,
    text: extraction.text || undefined,
    word_count: extraction.word_count,
    ...(hasContent ? {} : { error: "No extractable text" }),
  });
}

/** Fixed-size worker pool. Keeps total in-flight requests at `concurrency`. */
export async function crawlAll(
  urls: string[],
  options: CrawlOptions & { concurrency: number },
  onResult?: (record: CrawlRecord, done: number, total: number) => void,
): Promise<CrawlRecord[]> {
  const results: CrawlRecord[] = [];
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      const record = await crawlUrl(urls[index], options);
      results.push(record);
      done += 1;
      onResult?.(record, done, urls.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(options.concurrency, urls.length)) }, worker),
  );
  return results;
}
