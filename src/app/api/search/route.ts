import { NextResponse } from "next/server";

import { search } from "@/lib/search";
import { isTopicSlug } from "@/lib/topics";

/**
 * Search API used by the instant-search box, and generally useful on its own.
 *
 *   GET /api/search?q=vector%20search&topic=ai-ml&limit=5
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q") ?? "";
  const topicParam = params.get("topic") ?? undefined;
  const topic = topicParam && isTopicSlug(topicParam) ? topicParam : undefined;
  const limit = Math.min(50, Math.max(1, Number(params.get("limit") ?? 8) || 8));

  const response = await search(query, { topic, limit });

  return NextResponse.json(
    {
      query: response.query,
      topic: response.topic ?? null,
      mode: response.mode,
      total: response.total,
      took_ms: response.tookMs,
      notice: response.notice ?? null,
      results: response.results.map((result) => ({
        id: result.link.id,
        title: result.link.title,
        url: result.link.url,
        domain: result.link.domain,
        saved_at: result.link.saved_at,
        topics: result.link.topics,
        snippet: result.snippet,
        matched_in: result.matchedIn,
        score: Math.round(result.score * 1e4) / 1e4,
        keyword_rank: result.keywordRank ?? null,
        vector_rank: result.vectorRank ?? null,
        vector_score:
          result.vectorScore === undefined ? null : Math.round(result.vectorScore * 1e3) / 1e3,
      })),
    },
    { headers: { "cache-control": "public, max-age=0, s-maxage=60" } },
  );
}
