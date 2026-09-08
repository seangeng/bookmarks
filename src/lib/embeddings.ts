import { stem, tokenize } from "./text";
import type { EmbeddingProviderName } from "./types";

/**
 * Embedding providers.
 *
 * - `openai`  — real semantic embeddings (also works with any OpenAI-compatible
 *               endpoint via OPENAI_BASE_URL: Together, Groq, Ollama, ...).
 * - `local`   — dependency-free hashed n-gram embeddings. Not semantic, but
 *               deterministic, instant, and identical at index time and query
 *               time, so the site works end-to-end with zero credentials.
 *
 * Whichever provider built the index is recorded in `data/index/meta.json`;
 * query-time code reads it back so vectors are never compared across providers.
 */

export const LOCAL_DIMENSIONS = 512;
export const LOCAL_MODEL = "hashed-ngram-v1";

export type EmbeddingProvider = {
  name: EmbeddingProviderName;
  model: string;
  dimensions: number;
  embed(inputs: string[]): Promise<number[][]>;
};

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function addFeature(vector: Float64Array, feature: string, weight: number): void {
  const hash = fnv1a(feature);
  const bucket = hash % vector.length;
  // Second hash bit decides the sign, which keeps unrelated collisions from
  // systematically inflating similarity.
  const sign = (hash >>> 31) & 1 ? -1 : 1;
  vector[bucket] += sign * weight;
}

/** Hashed bag of words + word bigrams + character 4-grams, L2 normalized. */
export function localEmbed(input: string, dimensions = LOCAL_DIMENSIONS): number[] {
  const vector = new Float64Array(dimensions);
  const words = tokenize(input).map(stem);

  for (const word of words) {
    addFeature(vector, `w:${word}`, 1);
  }
  for (let i = 0; i + 1 < words.length; i += 1) {
    addFeature(vector, `b:${words[i]}_${words[i + 1]}`, 0.6);
  }
  for (const word of words) {
    if (word.length < 5) continue;
    for (let i = 0; i + 4 <= word.length; i += 1) {
      addFeature(vector, `c:${word.slice(i, i + 4)}`, 0.25);
    }
  }

  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (norm === 0) return Array.from(vector);
  return Array.from(vector, (value) => value / norm);
}

export function localProvider(): EmbeddingProvider {
  return {
    name: "local",
    model: LOCAL_MODEL,
    dimensions: LOCAL_DIMENSIONS,
    async embed(inputs) {
      return inputs.map((input) => localEmbed(input));
    },
  };
}

const OPENAI_MODEL_DIMENSIONS: Record<string, number> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
};

export function openAiProvider(options?: {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
}): EmbeddingProvider {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for the openai embedding provider");

  const baseUrl = (options?.baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1")
    .replace(/\/+$/, "");
  const model = options?.model ?? process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";
  const dimensions =
    options?.dimensions ??
    (process.env.EMBEDDING_DIMENSIONS ? Number(process.env.EMBEDDING_DIMENSIONS) : undefined) ??
    OPENAI_MODEL_DIMENSIONS[model] ??
    1536;

  return {
    name: "openai",
    model,
    dimensions,
    async embed(inputs) {
      if (inputs.length === 0) return [];
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: inputs.map((input) => input.slice(0, 8000)),
          ...(OPENAI_MODEL_DIMENSIONS[model] && dimensions !== OPENAI_MODEL_DIMENSIONS[model]
            ? { dimensions }
            : {}),
        }),
        signal: AbortSignal.timeout(60_000),
      });

      if (!response.ok) {
        throw new Error(
          `Embedding request failed (${response.status}): ${(await response.text()).slice(0, 300)}`,
        );
      }

      const payload = (await response.json()) as {
        data: { index: number; embedding: number[] }[];
      };
      return payload.data
        .slice()
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    },
  };
}

/**
 * Resolves the provider from env. `EMBEDDING_PROVIDER=openai|local` forces one;
 * otherwise we use OpenAI when a key exists and fall back to local embeddings.
 */
export function resolveEmbeddingProvider(preferred?: EmbeddingProviderName): EmbeddingProvider {
  const requested =
    preferred ?? (process.env.EMBEDDING_PROVIDER as EmbeddingProviderName | undefined);

  if (requested === "local") return localProvider();
  if (requested === "openai") return openAiProvider();
  return process.env.OPENAI_API_KEY ? openAiProvider() : localProvider();
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
