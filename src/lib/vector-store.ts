import { cosineSimilarity } from "./embeddings";
import type { StoredVectors, VectorStoreName } from "./types";

/**
 * Vector store abstraction.
 *
 * - `upstash` — Upstash Vector (serverless, free tier, no ops). Used whenever
 *   UPSTASH_VECTOR_REST_URL + UPSTASH_VECTOR_REST_TOKEN are set.
 * - `local`   — the committed `data/index/vectors.json` file, scored in-process.
 *   Exact cosine search over a few thousand bookmarks costs single-digit ms,
 *   so this is a legitimate default rather than a stub.
 */

export type VectorMatch = {
  id: string;
  score: number;
};

export type VectorQueryOptions = {
  topK?: number;
  /** Restrict results to bookmarks carrying this topic slug. */
  topic?: string;
  /** Ids to exclude, used for "related bookmarks". */
  exclude?: string[];
};

export type VectorRecord = {
  id: string;
  vector: number[];
  metadata: { topics: string[] };
};

export type VectorStore = {
  name: VectorStoreName;
  query(vector: number[], options?: VectorQueryOptions): Promise<VectorMatch[]>;
};

export type WritableVectorStore = VectorStore & {
  reset(): Promise<void>;
  upsert(records: VectorRecord[]): Promise<void>;
};

export function hasUpstashCredentials(): boolean {
  return Boolean(process.env.UPSTASH_VECTOR_REST_URL && process.env.UPSTASH_VECTOR_REST_TOKEN);
}

export function resolveVectorStoreName(preferred?: VectorStoreName): VectorStoreName {
  const requested = preferred ?? (process.env.VECTOR_STORE as VectorStoreName | undefined);
  if (requested === "local") return "local";
  if (requested === "upstash") return "upstash";
  return hasUpstashCredentials() ? "upstash" : "local";
}

/** Pure in-process store over an already-loaded vectors file. */
export function createLocalVectorStore(
  data: StoredVectors,
  topicsById: Map<string, string[]> = new Map(),
): VectorStore {
  const entries = Object.entries(data.vectors ?? {});

  return {
    name: "local",
    async query(vector, options = {}) {
      const { topK = 20, topic, exclude = [] } = options;
      const excluded = new Set(exclude);
      const matches: VectorMatch[] = [];

      for (const [id, candidate] of entries) {
        if (excluded.has(id)) continue;
        if (topic && !(topicsById.get(id) ?? []).includes(topic)) continue;
        matches.push({ id, score: cosineSimilarity(vector, candidate) });
      }

      matches.sort((a, b) => b.score - a.score);
      return matches.slice(0, topK);
    },
  };
}

type UpstashIndex = {
  upsert(records: { id: string; vector: number[]; metadata?: unknown }[]): Promise<unknown>;
  query(args: {
    vector: number[];
    topK: number;
    filter?: string;
    includeMetadata?: boolean;
  }): Promise<{ id: string | number; score: number }[]>;
  reset(): Promise<unknown>;
};

async function upstashIndex(): Promise<UpstashIndex> {
  const url = process.env.UPSTASH_VECTOR_REST_URL;
  const token = process.env.UPSTASH_VECTOR_REST_TOKEN;
  if (!url || !token) {
    throw new Error(
      "Upstash Vector selected but UPSTASH_VECTOR_REST_URL / UPSTASH_VECTOR_REST_TOKEN are missing",
    );
  }

  const { Index } = await import("@upstash/vector");
  const index = new Index({ url, token });
  const namespace = process.env.UPSTASH_VECTOR_NAMESPACE;
  return (namespace ? index.namespace(namespace) : index) as unknown as UpstashIndex;
}

export async function createUpstashVectorStore(): Promise<WritableVectorStore> {
  const index = await upstashIndex();

  return {
    name: "upstash",
    async query(vector, options = {}) {
      const { topK = 20, topic, exclude = [] } = options;
      const excluded = new Set(exclude);
      const results = await index.query({
        vector,
        topK: topK + excluded.size,
        includeMetadata: false,
        ...(topic ? { filter: `topics CONTAINS '${topic.replace(/'/g, "")}'` } : {}),
      });

      return results
        .map((match) => ({ id: String(match.id), score: match.score }))
        .filter((match) => !excluded.has(match.id))
        .slice(0, topK);
    },
    async reset() {
      await index.reset();
    },
    async upsert(records) {
      const batchSize = 50;
      for (let i = 0; i < records.length; i += batchSize) {
        await index.upsert(records.slice(i, i + batchSize));
      }
    },
  };
}
