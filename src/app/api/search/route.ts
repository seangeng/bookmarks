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
        id: result.bookmark.id,
        author: result.bookmark.author,
        created_at: result.bookmark.created_at,
        topics: result.bookmark.topics,
        domain: result.bookmark.links[0]?.domain ?? null,
        snippet: result.snippet,
        matched_in: result.matchedIn,
        score: Math.round(result.score * 1e4) / 1e4,
        vector_score:
          result.vectorScore === undefined ? null : Math.round(result.vectorScore * 1e3) / 1e3,
      })),
    },
    { headers: { "cache-control": "public, max-age=0, s-maxage=60" } },
  );
}
