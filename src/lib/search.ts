import "server-only";

import vectorsJson from "../../data/index/vectors.json";
import { resolveEmbeddingProvider } from "./embeddings";
import { bookmarks, indexMeta } from "./library";
import { snippetFor, terms } from "./text";
import type { IndexedBookmark, StoredVectors } from "./types";
import {
  createLocalVectorStore,
  createUpstashVectorStore,
  hasUpstashCredentials,
  type VectorStore,
} from "./vector-store";

/**
 * Hybrid search: BM25 keyword scoring fused with vector similarity via
 * reciprocal rank fusion. Keyword search always works; the vector leg is
 * skipped (and `mode` reports "keyword") if the embedding provider that built
 * the index is unavailable at request time.
 */

const K1 = 1.4;
const B = 0.75;
const RRF_K = 60;
const KEYWORD_WEIGHT = 1;
const VECTOR_WEIGHT = 1.15;

export type SearchMode = "hybrid" | "keyword" | "recent";

export type SearchResult = {
  bookmark: IndexedBookmark;
  score: number;
  keywordRank?: number;
  vectorRank?: number;
  vectorScore?: number;
  snippet: string;
  /** Where the strongest evidence for this hit came from. */
  matchedIn: "post" | "link" | "topic" | "semantic";
};

export type SearchResponse = {
  query: string;
  topic?: string;
  mode: SearchMode;
  total: number;
  results: SearchResult[];
  tookMs: number;
  notice?: string;
};

/* ------------------------------------------------------------- keyword leg */

type KeywordIndex = {
  postings: Map<string, Map<number, number>>;
  lengths: number[];
  averageLength: number;
};

let keywordIndex: KeywordIndex | null = null;

function buildKeywordIndex(): KeywordIndex {
  const postings = new Map<string, Map<number, number>>();
  const lengths: number[] = [];

  bookmarks.forEach((bookmark, position) => {
    const tokens = terms(bookmark.search_text);
    lengths[position] = tokens.length || 1;
    for (const token of tokens) {
      let posting = postings.get(token);
      if (!posting) {
        posting = new Map();
        postings.set(token, posting);
      }
      posting.set(position, (posting.get(position) ?? 0) + 1);
    }
  });

  const total = lengths.reduce((sum, length) => sum + length, 0);
  return {
    postings,
    lengths,
    averageLength: bookmarks.length > 0 ? total / bookmarks.length : 1,
  };
}

function getKeywordIndex(): KeywordIndex {
  keywordIndex ??= buildKeywordIndex();
  return keywordIndex;
}

function keywordSearch(query: string): { position: number; score: number }[] {
  const index = getKeywordIndex();
  const queryTerms = terms(query);
  if (queryTerms.length === 0) return [];

  const documentCount = bookmarks.length;
  const scores = new Map<number, number>();

  for (const term of queryTerms) {
    const posting = index.postings.get(term);
    if (!posting) continue;
    const idf = Math.log(1 + (documentCount - posting.size + 0.5) / (posting.size + 0.5));

    for (const [position, frequency] of posting) {
      const length = index.lengths[position];
      const denominator = frequency + K1 * (1 - B + (B * length) / index.averageLength);
      scores.set(position, (scores.get(position) ?? 0) + idf * ((frequency * (K1 + 1)) / denominator));
    }
  }

  // Exact-phrase hits are worth more than the sum of their terms.
  const phrase = query.trim().toLowerCase();
  if (phrase.length > 4) {
    for (const [position, score] of scores) {
      if (bookmarks[position].search_text.toLowerCase().includes(phrase)) {
        scores.set(position, score * 1.35);
      }
    }
  }

  return [...scores.entries()]
    .map(([position, score]) => ({ position, score }))
    .sort((a, b) => b.score - a.score);
}

/* -------------------------------------------------------------- vector leg */

let storePromise: Promise<VectorStore> | null = null;

function localStore(): VectorStore {
  const data = vectorsJson as unknown as StoredVectors;
  const topicsById = new Map(bookmarks.map((bookmark) => [bookmark.id, bookmark.topics]));
  return createLocalVectorStore(data, topicsById);
}

async function getVectorStore(): Promise<VectorStore> {
  storePromise ??= (async () => {
    if (indexMeta.vector_store === "upstash" && hasUpstashCredentials()) {
      try {
        return await createUpstashVectorStore();
      } catch (error) {
        console.warn("Upstash Vector unavailable, using local vectors:", error);
      }
    }
    return localStore();
  })();
  return storePromise;
}

async function vectorSearch(
  query: string,
  topic: string | undefined,
  limit: number,
): Promise<{ matches: { id: string; score: number }[]; notice?: string }> {
  try {
    const provider = resolveEmbeddingProvider(indexMeta.embedding.provider);
    if (provider.dimensions !== indexMeta.embedding.dimensions) {
      return {
        matches: [],
        notice:
          `Embedding dimension mismatch (index ${indexMeta.embedding.dimensions}d, ` +
          `runtime ${provider.dimensions}d). Re-run npm run index.`,
      };
    }
    const [vector] = await provider.embed([query]);
    const store = await getVectorStore();
    return { matches: await store.query(vector, { topK: limit, topic }) };
  } catch (error) {
    return {
      matches: [],
      notice: `Semantic search unavailable (${
        error instanceof Error ? error.message : "unknown error"
      }). Showing keyword results.`,
    };
  }
}

/* ----------------------------------------------------------------- fusion */

function bestSnippet(bookmark: IndexedBookmark, query: string): {
  snippet: string;
  matchedIn: SearchResult["matchedIn"];
} {
  const queryTerms = new Set(terms(query));
  const candidates: { text: string; source: SearchResult["matchedIn"] }[] = [
    { text: bookmark.text, source: "post" },
  ];
  for (const link of bookmark.links) {
    const crawl = link.crawl;
    if (!crawl) continue;
    const text = [crawl.title, crawl.description, crawl.excerpt].filter(Boolean).join(" — ");
    if (text) candidates.push({ text, source: "link" });
  }

  let best = { snippet: bookmark.summary, matchedIn: "semantic" as SearchResult["matchedIn"] };
  let bestHits = -1;
  for (const candidate of candidates) {
    const hits = terms(candidate.text).filter((token) => queryTerms.has(token)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = { snippet: snippetFor(candidate.text, query), matchedIn: candidate.source };
    }
  }
  if (bestHits <= 0) {
    const topicHit = bookmark.topics.some((topic) =>
      queryTerms.has(topic.replace(/-/g, " ").split(" ")[0]),
    );
    return {
      snippet: snippetFor(bookmark.text || bookmark.summary, query),
      matchedIn: topicHit ? "topic" : "semantic",
    };
  }
  return best;
}

export type SearchOptions = {
  topic?: string;
  limit?: number;
  /** Vector/keyword candidate depth before fusion. */
  candidates?: number;
};

export async function search(
  rawQuery: string,
  { topic, limit = 30, candidates = 60 }: SearchOptions = {},
): Promise<SearchResponse> {
  const started = Date.now();
  const query = rawQuery.trim();
  const inTopic = (bookmark: IndexedBookmark) => !topic || bookmark.topics.includes(topic);

  if (query.length === 0) {
    const results = bookmarks.filter(inTopic).slice(0, limit);
    return {
      query,
      topic,
      mode: "recent",
      total: bookmarks.filter(inTopic).length,
      tookMs: Date.now() - started,
      results: results.map((bookmark) => ({
        bookmark,
        score: 0,
        snippet: bookmark.summary,
        matchedIn: "post",
      })),
    };
  }

  const keywordHits = keywordSearch(query)
    .filter((hit) => inTopic(bookmarks[hit.position]))
    .slice(0, candidates);
  const { matches: vectorHits, notice } = await vectorSearch(query, topic, candidates);

  const fused = new Map<
    string,
    { score: number; keywordRank?: number; vectorRank?: number; vectorScore?: number }
  >();

  keywordHits.forEach((hit, rank) => {
    const id = bookmarks[hit.position].id;
    const entry = fused.get(id) ?? { score: 0 };
    entry.score += KEYWORD_WEIGHT / (RRF_K + rank + 1);
    entry.keywordRank = rank + 1;
    fused.set(id, entry);
  });

  vectorHits.forEach((hit, rank) => {
    // Near-zero cosine similarity is noise, not a match.
    if (hit.score <= 0.05) return;
    const entry = fused.get(hit.id) ?? { score: 0 };
    entry.score += VECTOR_WEIGHT / (RRF_K + rank + 1);
    entry.vectorRank = rank + 1;
    entry.vectorScore = hit.score;
    fused.set(hit.id, entry);
  });

  const ranked = [...fused.entries()]
    .map(([id, entry]) => {
      const bookmark = bookmarks.find((candidate) => candidate.id === id);
      return bookmark && inTopic(bookmark) ? { bookmark, ...entry } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score);

  const results: SearchResult[] = ranked.slice(0, limit).map((entry) => ({
    bookmark: entry.bookmark,
    score: entry.score,
    keywordRank: entry.keywordRank,
    vectorRank: entry.vectorRank,
    vectorScore: entry.vectorScore,
    ...bestSnippet(entry.bookmark, query),
  }));

  return {
    query,
    topic,
    mode: vectorHits.length > 0 ? "hybrid" : "keyword",
    total: ranked.length,
    results,
    tookMs: Date.now() - started,
    notice,
  };
}
