/**
 * Build the search index: enrich bookmarks with crawl content, auto-tag topics,
 * embed everything, compute related bookmarks, and persist vectors.
 *
 *   npm run index                    # auto-detect provider + store from env
 *   npm run index -- --provider=local --store=local
 *   npm run index -- --no-llm        # force heuristic topic classification
 *   npm run index -- --dry-run       # report only, write nothing
 *
 * Outputs:
 *   data/index/bookmarks.json  read model rendered by the site
 *   data/index/vectors.json    local vector store (also the Upstash payload)
 *   data/index/meta.json       provider/store/topic stats
 */
import { loadCrawlRecords } from "./lib/artifacts";
import {
  BOOKMARKS_INDEX_FILE,
  INDEX_DIR,
  META_FILE,
  SEED_FILE,
  VECTORS_FILE,
  loadEnv,
  numberArg,
  parseArgs,
  readJson,
  relative,
  urlKey,
  writeJson,
} from "./lib/fs-data";
import { classifyWithLlm } from "./lib/classify";
import { cosineSimilarity, resolveEmbeddingProvider } from "../src/lib/embeddings";
import { normalizeExport } from "../src/lib/normalize";
import { domainOf, truncate } from "../src/lib/text";
import { DEFAULT_TOPIC, TOPICS, pickTopics, scoreTopics, toTopicSlug } from "../src/lib/topics";
import type {
  BookmarkLink,
  CrawlRecord,
  EmbeddingProviderName,
  IndexMeta,
  IndexedBookmark,
  StoredVectors,
  VectorStoreName,
} from "../src/lib/types";
import {
  createUpstashVectorStore,
  hasUpstashCredentials,
  resolveVectorStoreName,
} from "../src/lib/vector-store";

const EXCERPT_CHARS = 700;
/** How much crawl text feeds the embedding for each link. */
const EMBED_CRAWL_CHARS = 1200;
const RELATED_COUNT = 6;

function toLink(url: string, crawl?: CrawlRecord): BookmarkLink {
  return {
    url,
    domain: domainOf(url),
    ...(crawl
      ? {
          crawl: {
            status: crawl.status,
            http_status: crawl.http_status,
            title: crawl.title,
            description: crawl.description,
            site_name: crawl.site_name,
            excerpt: crawl.text ? truncate(crawl.text, EXCERPT_CHARS) : undefined,
            word_count: crawl.word_count,
            fetched_at: crawl.fetched_at,
            error: crawl.error,
          },
        }
      : {}),
  };
}

/** The document we embed: post text, then link titles/descriptions/body, then topics. */
function embeddingDocument(
  bookmark: { text: string; author: { handle: string } },
  links: BookmarkLink[],
  crawls: (CrawlRecord | undefined)[],
  topics: string[],
): string {
  const parts = [bookmark.text, `by @${bookmark.author.handle}`];
  links.forEach((link, position) => {
    const crawl = crawls[position];
    parts.push(link.domain);
    if (crawl?.title) parts.push(crawl.title);
    if (crawl?.description) parts.push(crawl.description);
    if (crawl?.text) parts.push(crawl.text.slice(0, EMBED_CRAWL_CHARS));
  });
  parts.push(topics.map((topic) => topic.replace(/-/g, " ")).join(" "));
  return parts.filter(Boolean).join("\n");
}

function buildSummary(
  text: string,
  links: BookmarkLink[],
): string {
  const described = links.find((link) => link.crawl?.description)?.crawl?.description;
  const titled = links.find((link) => link.crawl?.title)?.crawl?.title;
  const excerpt = links.find((link) => link.crawl?.excerpt)?.crawl?.excerpt;
  const candidate = text.replace(/https?:\/\/\S+/g, "").trim();
  return truncate(candidate.length > 60 ? candidate : (described ?? titled ?? excerpt ?? candidate), 280);
}

async function main(): Promise<void> {
  await loadEnv();
  const args = parseArgs();
  const dryRun = args.flags.has("dry-run");

  const seed = await readJson<unknown>(SEED_FILE);
  if (!seed) {
    console.error(`No seed found at ${relative(SEED_FILE)}. Add the X export first.`);
    process.exit(1);
  }

  const { bookmarks, skipped } = normalizeExport(seed);
  if (bookmarks.length === 0) {
    console.error("Seed contained no usable bookmarks.");
    process.exit(1);
  }
  if (skipped > 0) console.warn(`Skipped ${skipped} malformed seed entries.`);

  const { records: crawls, invalid } = await loadCrawlRecords();
  if (invalid.length > 0) {
    console.warn(`Ignoring ${invalid.length} malformed artifact(s): ${invalid.join(", ")}`);
  }
  const crawledLinks = [...crawls.values()].filter((record) => record.status === "ok").length;
  console.log(
    `${bookmarks.length} bookmarks · ${crawls.size} crawl artifacts (${crawledLinks} with content)`,
  );

  /* ------------------------------------------------------------- topics */

  const useLlm =
    !args.flags.has("no-llm") &&
    Boolean(process.env.OPENAI_API_KEY) &&
    (args.values.get("classifier") ?? "auto") !== "heuristic";

  const prepared = bookmarks.map((bookmark) => {
    const linkCrawls = bookmark.external_urls.map((url) => crawls.get(urlKey(url)));
    const links = bookmark.external_urls.map((url, position) => toLink(url, linkCrawls[position]));
    const classifierText = [
      bookmark.text,
      ...links.map((link) => link.domain),
      ...linkCrawls.flatMap((crawl) => [crawl?.title, crawl?.description, crawl?.text?.slice(0, 1500)]),
    ]
      .filter(Boolean)
      .join("\n");
    return { bookmark, links, linkCrawls, classifierText };
  });

  const heuristicScores = prepared.map(({ bookmark, links, classifierText }) =>
    scoreTopics({
      text: classifierText,
      urls: links.map((link) => link.url),
      hints: bookmark.topics,
    }),
  );

  let llmTopics: (string[] | null)[] = prepared.map(() => null);
  if (useLlm) {
    console.log("Classifying topics with LLM…");
    try {
      llmTopics = await classifyWithLlm(
        prepared.map(({ bookmark, classifierText }) => ({
          id: bookmark.id,
          text: truncate(classifierText, 1400),
        })),
      );
    } catch (error) {
      console.warn(
        `LLM classification failed, falling back to heuristics: ${
          error instanceof Error ? error.message : error
        }`,
      );
      llmTopics = prepared.map(() => null);
    }
  }

  const enriched: IndexedBookmark[] = prepared.map(
    ({ bookmark, links, linkCrawls }, position) => {
      const scores = heuristicScores[position];
      const fromLlm = (llmTopics[position] ?? [])
        .map(toTopicSlug)
        .filter((slug): slug is NonNullable<typeof slug> => Boolean(slug));
      const fromSeed = bookmark.topics
        .map(toTopicSlug)
        .filter((slug): slug is NonNullable<typeof slug> => Boolean(slug));

      const chosen = [...new Set([...fromSeed, ...fromLlm])];
      const topics = chosen.length > 0 ? chosen.slice(0, 3) : pickTopics(scores);

      const searchText = [
        bookmark.text,
        `@${bookmark.author.handle} ${bookmark.author.name}`,
        ...links.map((link) => link.domain),
        ...linkCrawls.flatMap((crawl) => [crawl?.title, crawl?.description, crawl?.text]),
        topics.map((topic) => topic.replace(/-/g, " ")).join(" "),
      ]
        .filter(Boolean)
        .join("\n");

      return {
        ...bookmark,
        topics,
        topic_scores: scores,
        links,
        summary: buildSummary(bookmark.text, links),
        search_text: searchText,
        related: [],
        crawled_words: linkCrawls.reduce((total, crawl) => total + (crawl?.word_count ?? 0), 0),
      };
    },
  );

  /* --------------------------------------------------------- embeddings */

  const provider = resolveEmbeddingProvider(
    args.values.get("provider") as EmbeddingProviderName | undefined,
  );
  console.log(
    `Embedding with ${provider.name} (${provider.model}, ${provider.dimensions}d)` +
      `${provider.name === "local" ? " — set OPENAI_API_KEY for true semantic search" : ""}`,
  );

  const documents = enriched.map((bookmark, position) =>
    embeddingDocument(
      bookmark,
      bookmark.links,
      prepared[position].linkCrawls,
      bookmark.topics,
    ),
  );

  const batchSize = numberArg(args, "batch", provider.name === "local" ? 512 : 64);
  const vectors: number[][] = [];
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    vectors.push(...(await provider.embed(batch)));
    if (documents.length > batchSize) {
      console.log(`  embedded ${Math.min(i + batch.length, documents.length)}/${documents.length}`);
    }
  }

  /* ------------------------------------------------------------ related */

  enriched.forEach((bookmark, position) => {
    const scored = enriched
      .map((candidate, other) =>
        other === position
          ? null
          : { id: candidate.id, score: cosineSimilarity(vectors[position], vectors[other]) },
      )
      .filter((entry): entry is { id: string; score: number } => entry !== null)
      .sort((a, b) => b.score - a.score)
      .filter((entry) => entry.score > 0.02)
      .slice(0, RELATED_COUNT);
    bookmark.related = scored.map((entry) => entry.id);
  });

  /* -------------------------------------------------------------- write */

  const topicCounts = TOPICS.map((topic) => ({
    slug: topic.slug,
    count: enriched.filter((bookmark) => bookmark.topics.includes(topic.slug)).length,
  })).filter((entry) => entry.count > 0 || entry.slug === DEFAULT_TOPIC);

  const storeName: VectorStoreName = resolveVectorStoreName(
    args.values.get("store") as VectorStoreName | undefined,
  );

  const stored: StoredVectors = {
    dimensions: provider.dimensions,
    provider: provider.name,
    model: provider.model,
    vectors: Object.fromEntries(
      enriched.map((bookmark, position) => [
        bookmark.id,
        vectors[position].map((value) => Math.round(value * 1e5) / 1e5),
      ]),
    ),
  };

  const meta: IndexMeta = {
    generated_at: new Date().toISOString(),
    bookmark_count: enriched.length,
    crawled_link_count: crawledLinks,
    embedding: {
      provider: provider.name,
      model: provider.model,
      dimensions: provider.dimensions,
    },
    vector_store: storeName,
    classifier: llmTopics.some(Boolean) ? "llm" : "heuristic",
    topics: topicCounts,
  };

  if (dryRun) {
    console.log("\n--dry-run: nothing written");
    console.log(JSON.stringify(meta, null, 2));
    return;
  }

  await writeJson(BOOKMARKS_INDEX_FILE, enriched);
  await writeJson(VECTORS_FILE, stored, false);
  await writeJson(META_FILE, meta);

  if (storeName === "upstash") {
    if (!hasUpstashCredentials()) {
      console.warn("Upstash requested but credentials are missing — skipped remote upsert.");
    } else {
      console.log("Upserting vectors to Upstash Vector…");
      const store = await createUpstashVectorStore();
      if (!args.flags.has("no-reset")) await store.reset();
      await store.upsert(
        enriched.map((bookmark, position) => ({
          id: bookmark.id,
          vector: vectors[position],
          metadata: { topics: bookmark.topics },
        })),
      );
      console.log(`Upserted ${enriched.length} vectors.`);
    }
  }

  console.log(`\nWrote ${relative(INDEX_DIR)}/{bookmarks,vectors,meta}.json`);
  console.log(
    `Topics: ${meta.topics.map((topic) => `${topic.slug}=${topic.count}`).join(" ")} ` +
      `· classifier=${meta.classifier} · store=${meta.vector_store}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
