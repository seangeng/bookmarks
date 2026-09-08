import "server-only";

import vectorsJson from "../../data/index/vectors.json";
import { resolveEmbeddingProvider } from "./embeddings";
import { indexMeta, links } from "./library";
import { snippetFor, terms } from "./text";
import type { LibraryLink, StoredVectors } from "./types";
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

/**
 * Fusion.
 *
 * Rank-based fusion (RRF) is deliberately insensitive to score magnitude, which
 * is wrong here: a query like "error budgets" has one obviously correct answer
 * and a long tail of documents that merely contain the word "error". So each
 * leg is normalized instead — keyword scores against the best hit in the same
 * query, cosine similarity against a provider-calibrated window — and the two
 * are added.
 *
 * The calibration window is what keeps the local provider honest: its hashed
 * n-gram vectors are lexical rather than semantic, and a 0.06 cosine is weak
 * evidence, so it contributes a nudge. Real embeddings clear the window and
 * become a first-class ranking signal.
 */
const KEYWORD_WEIGHT = 1;

const VECTOR_CALIBRATION = {
  local: { low: 0.04, high: 0.3, weight: 0.8 },
  openai: { low: 0.22, high: 0.7, weight: 1.1 },
} as const;

/** Vector hits far weaker than the best one are noise, not recall. */
const VECTOR_RELATIVE_FLOOR = 0.4;
const VECTOR_ABSOLUTE_FLOOR = 0.02;
/** Confidence a vector-only hit must clear to outrank nothing at all. */
const VECTOR_ONLY_MIN_CONFIDENCE = 0.12;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Light suffix folding only gets us so far: "accessible" and "accessibility"
 * survive it as different terms. So every long token is additionally indexed
 * under a truncated prefix at reduced weight, which buys morphological recall
 * without the false positives of full prefix matching.
 */
const PREFIX_LENGTH = 6;
const PREFIX_WEIGHT = 0.35;

function prefixKey(token: string): string | null {
  return token.length > PREFIX_LENGTH ? `~${token.slice(0, PREFIX_LENGTH)}` : null;
}

export type SearchMode = "hybrid" | "keyword" | "recent";

export type SearchResult = {
  link: LibraryLink;
  score: number;
  keywordRank?: number;
  vectorRank?: number;
  vectorScore?: number;
  snippet: string;
  /** Where the strongest evidence for this hit came from. */
  matchedIn: "title" | "page" | "topic" | "semantic";
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
  /** Text of the high-signal fields, for the phrase bonus. */
  headlines: string[];
};

/**
 * BM25F-style field weights. A term in the page title or its meta description
 * matters far more than the same term buried deep in the crawled body.
 */
const FIELD_WEIGHTS = {
  title: 3.4,
  description: 2.4,
  domain: 2.2,
  topics: 2,
  body: 1,
} as const;

let keywordIndex: KeywordIndex | null = null;

function headlineOf(link: LibraryLink): string {
  return [link.title, link.description, link.domain, link.site_name].filter(Boolean).join(" ");
}

function buildKeywordIndex(): KeywordIndex {
  const postings = new Map<string, Map<number, number>>();
  const lengths: number[] = [];
  const headlines: string[] = [];

  links.forEach((link, position) => {
    headlines[position] = headlineOf(link);

    // `search_text` already contains every field, so it acts as the body
    // baseline and the rest are additive boosts on top of it.
    const fields: [string, number][] = [
      [link.search_text, FIELD_WEIGHTS.body],
      [link.title, FIELD_WEIGHTS.title],
      [link.description ?? "", FIELD_WEIGHTS.description],
      [link.domain.replace(/\./g, " "), FIELD_WEIGHTS.domain],
      [link.topics.join(" ").replace(/-/g, " "), FIELD_WEIGHTS.topics],
    ];

    const add = (key: string, weight: number) => {
      let posting = postings.get(key);
      if (!posting) {
        posting = new Map();
        postings.set(key, posting);
      }
      posting.set(position, (posting.get(position) ?? 0) + weight);
    };

    let length = 0;
    for (const [text, weight] of fields) {
      const tokens = terms(text);
      if (weight === FIELD_WEIGHTS.body) length = tokens.length;
      for (const token of tokens) {
        add(token, weight);
        const prefix = prefixKey(token);
        if (prefix) add(prefix, weight * PREFIX_WEIGHT);
      }
    }
    lengths[position] = length || 1;
  });

  const total = lengths.reduce((sum, value) => sum + value, 0);
  return {
    postings,
    lengths,
    headlines,
    averageLength: links.length > 0 ? total / links.length : 1,
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

  const documentCount = links.length;
  const scores = new Map<number, number>();

  const scoreTerm = (key: string, factor: number) => {
    const posting = index.postings.get(key);
    if (!posting) return;
    const idf = Math.log(1 + (documentCount - posting.size + 0.5) / (posting.size + 0.5));

    for (const [position, frequency] of posting) {
      const length = index.lengths[position];
      const denominator = frequency + K1 * (1 - B + (B * length) / index.averageLength);
      const contribution = idf * ((frequency * (K1 + 1)) / denominator) * factor;
      scores.set(position, (scores.get(position) ?? 0) + contribution);
    }
  };

  const seen = new Set<string>();
  for (const term of queryTerms) {
    if (seen.has(term)) continue;
    seen.add(term);
    scoreTerm(term, 1);
    const prefix = prefixKey(term);
    if (prefix) scoreTerm(prefix, PREFIX_WEIGHT);
  }

  // Exact-phrase hits are worth more than the sum of their terms, and a phrase
  // in the title or description is worth more than one in the body.
  const phrase = query.trim().toLowerCase();
  if (phrase.length > 4) {
    for (const [position, score] of scores) {
      if (index.headlines[position].toLowerCase().includes(phrase)) {
        scores.set(position, score * 1.6);
      } else if (links[position].search_text.toLowerCase().includes(phrase)) {
        scores.set(position, score * 1.25);
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
  const topicsById = new Map(links.map((link) => [link.id, link.topics]));
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

function bestSnippet(link: LibraryLink, query: string): {
  snippet: string;
  matchedIn: SearchResult["matchedIn"];
} {
  const queryTerms = new Set(terms(query));
  const candidates: { text: string; source: SearchResult["matchedIn"] }[] = [
    { text: [link.title, link.description].filter(Boolean).join(" — "), source: "title" },
    { text: link.excerpt ?? "", source: "page" },
  ];

  let best = {
    snippet: link.description ?? link.excerpt ?? link.title,
    matchedIn: "semantic" as SearchResult["matchedIn"],
  };
  let bestHits = -1;
  for (const candidate of candidates) {
    if (!candidate.text) continue;
    const hits = terms(candidate.text).filter((token) => queryTerms.has(token)).length;
    if (hits > bestHits) {
      bestHits = hits;
      best = { snippet: snippetFor(candidate.text, query), matchedIn: candidate.source };
    }
  }

  if (bestHits <= 0) {
    const topicHit = link.topics.some((topic) =>
      queryTerms.has(topic.replace(/-/g, " ").split(" ")[0]),
    );
    return {
      snippet: snippetFor(link.description || link.excerpt || link.title, query),
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
  const inTopic = (link: LibraryLink) => !topic || link.topics.includes(topic);

  if (query.length === 0) {
    const matching = links.filter(inTopic);
    return {
      query,
      topic,
      mode: "recent",
      total: matching.length,
      tookMs: Date.now() - started,
      results: matching.slice(0, limit).map((link) => ({
        link,
        score: 0,
        snippet: link.description ?? link.excerpt ?? "",
        matchedIn: "title",
      })),
    };
  }

  const keywordHits = keywordSearch(query)
    .filter((hit) => inTopic(links[hit.position]))
    .slice(0, candidates);
  const { matches: vectorHits, notice } = await vectorSearch(query, topic, candidates);

  type Fused = {
    score: number;
    keywordRank?: number;
    vectorRank?: number;
    vectorScore?: number;
    confidence?: number;
  };
  const fused = new Map<string, Fused>();

  const topKeywordScore = keywordHits[0]?.score ?? 0;
  keywordHits.forEach((hit, rank) => {
    const id = links[hit.position].id;
    const entry = fused.get(id) ?? { score: 0 };
    entry.score += topKeywordScore > 0 ? (KEYWORD_WEIGHT * hit.score) / topKeywordScore : 0;
    entry.keywordRank = rank + 1;
    fused.set(id, entry);
  });

  const calibration =
    VECTOR_CALIBRATION[indexMeta.embedding.provider] ?? VECTOR_CALIBRATION.openai;
  const topVectorScore = vectorHits[0]?.score ?? 0;
  const vectorCutoff = Math.max(VECTOR_ABSOLUTE_FLOOR, topVectorScore * VECTOR_RELATIVE_FLOOR);

  vectorHits.forEach((hit, rank) => {
    if (hit.score < vectorCutoff) return;
    const confidence = clamp01(
      (hit.score - calibration.low) / (calibration.high - calibration.low),
    );
    const entry = fused.get(hit.id) ?? { score: 0 };
    entry.score += calibration.weight * confidence;
    entry.vectorRank = rank + 1;
    entry.vectorScore = hit.score;
    entry.confidence = confidence;
    fused.set(hit.id, entry);
  });

  const byId = new Map(links.map((link) => [link.id, link]));

  const ranked = [...fused.entries()]
    .map(([id, entry]) => {
      const link = byId.get(id);
      if (!link || !inTopic(link)) return null;
      // A vector-only hit needs real semantic confidence to earn a slot; below
      // that it is just the nearest of however many unrelated pages.
      if (
        entry.keywordRank === undefined &&
        (entry.confidence ?? 0) < VECTOR_ONLY_MIN_CONFIDENCE
      ) {
        return null;
      }
      return { link, ...entry };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => b.score - a.score);

  const results: SearchResult[] = ranked.slice(0, limit).map((entry) => ({
    link: entry.link,
    score: entry.score,
    keywordRank: entry.keywordRank,
    vectorRank: entry.vectorRank,
    vectorScore: entry.vectorScore,
    ...bestSnippet(entry.link, query),
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
