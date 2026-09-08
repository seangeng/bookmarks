import * as cheerio from "cheerio";
import { collapseWhitespace } from "../../src/lib/text";

export type Extraction = {
  title?: string;
  description?: string;
  site_name?: string;
  byline?: string;
  published_at?: string;
  text: string;
  word_count: number;
};

const STRIP_SELECTORS = [
  "script", "style", "noscript", "template", "svg", "iframe", "form",
  "nav", "header", "footer", "aside", "figure figcaption", "button",
  "[aria-hidden='true']", "[role='navigation']", "[role='banner']",
  "[role='contentinfo']", ".sidebar", "#sidebar", ".nav", ".navbar",
  ".menu", ".comments", "#comments", ".advertisement", ".cookie",
  ".newsletter", ".related-posts", ".share", ".social",
];

/** Ordered by how likely the container is to be the real article body. */
const CONTENT_SELECTORS = [
  "article",
  "main",
  "[role='main']",
  ".post-content",
  ".entry-content",
  ".article-body",
  ".markdown-body",
  ".prose",
  "#content",
  ".content",
  "blockquote.abstract",
  "body",
];

const BLOCK_SELECTOR = "p, li, h1, h2, h3, h4, blockquote, pre, dd, td";

function meta($: cheerio.CheerioAPI, ...names: string[]): string | undefined {
  for (const name of names) {
    const value =
      $(`meta[property='${name}']`).attr("content") ??
      $(`meta[name='${name}']`).attr("content");
    if (value && value.trim()) return collapseWhitespace(value);
  }
  return undefined;
}

function blockText($: cheerio.CheerioAPI, scope: cheerio.Cheerio<never>): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  scope.find(BLOCK_SELECTOR).each((_, element) => {
    const raw = collapseWhitespace($(element).text());
    if (raw.length < 24) return;
    if (seen.has(raw)) return;
    seen.add(raw);
    parts.push(raw);
  });

  if (parts.length === 0) {
    const fallback = collapseWhitespace(scope.text());
    return fallback;
  }
  return parts.join("\n\n");
}

/**
 * Best-effort readability: strip chrome, find the densest plausible content
 * container, and keep block-level text up to `maxChars`.
 */
export function extractArticle(
  html: string,
  { maxChars = 5000 }: { maxChars?: number } = {},
): Extraction {
  const $ = cheerio.load(html);

  const title =
    meta($, "og:title", "twitter:title") ??
    collapseWhitespace($("title").first().text()) ??
    collapseWhitespace($("h1").first().text());

  const description = meta($, "og:description", "twitter:description", "description");
  const siteName = meta($, "og:site_name", "application-name");
  const byline =
    meta($, "author", "article:author", "twitter:creator") ??
    collapseWhitespace($("[rel='author']").first().text()) ??
    undefined;
  const publishedRaw =
    meta($, "article:published_time", "datePublished", "date", "pubdate") ??
    $("time[datetime]").first().attr("datetime");
  const published = publishedRaw ? new Date(publishedRaw) : null;

  $(STRIP_SELECTORS.join(", ")).remove();

  let best = "";
  for (const selector of CONTENT_SELECTORS) {
    const scope = $(selector).first() as unknown as cheerio.Cheerio<never>;
    if (scope.length === 0) continue;
    const candidate = blockText($, scope);
    if (candidate.length > best.length) best = candidate;
    // Enough signal to stop hunting through weaker containers.
    if (best.length > 1200) break;
  }

  const text = best.slice(0, maxChars).trim();

  return {
    title: title || undefined,
    description: description || undefined,
    site_name: siteName || undefined,
    byline: byline || undefined,
    published_at:
      published && !Number.isNaN(published.getTime()) ? published.toISOString() : undefined,
    text,
    word_count: text ? text.split(/\s+/).length : 0,
  };
}
