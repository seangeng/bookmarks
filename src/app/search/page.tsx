import { Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { LinkCard } from "@/components/link-card";
import { SearchBox } from "@/components/search-box";
import { getTopicSummaries } from "@/lib/library";
import { search } from "@/lib/search";
import { isTopicSlug, topicLabel } from "@/lib/topics";
import { cn } from "cn";

type SearchParams = Promise<{ q?: string; topic?: string }>;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: SearchParams;
}): Promise<Metadata> {
  const { q } = await searchParams;
  return {
    title: q ? `“${q}”` : "Search",
    description: q
      ? `Saved sites matching “${q}” across page titles, archived text, and topics.`
      : "Search the library of saved sites.",
    robots: { index: false, follow: true },
  };
}

const MATCH_LABELS: Record<string, string> = {
  title: "title",
  page: "page text",
  topic: "topic",
  semantic: "semantic",
};

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = (params.q ?? "").slice(0, 200);
  const topic = params.topic && isTopicSlug(params.topic) ? params.topic : undefined;
  const response = await search(query, { topic, limit: 40 });
  const topics = getTopicSummaries().sort((a, b) => b.count - a.count);

  const withTopic = (slug?: string) => {
    const next = new URLSearchParams();
    if (query) next.set("q", query);
    if (slug) next.set("topic", slug);
    const suffix = next.toString();
    return suffix ? `/search?${suffix}` : "/search";
  };

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="font-heading text-2xl tracking-tight">Search</h1>
      <div className="mt-4">
        <SearchBox initialQuery={query} topic={topic} instant={false} size="lg" />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <Link
          href={withTopic()}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
            topic
              ? "border-border/80 text-muted-foreground hover:text-foreground"
              : "border-primary/40 bg-primary/10 text-foreground",
          )}
        >
          All topics
        </Link>
        {topics.map((entry) => (
          <Link
            key={entry.slug}
            href={withTopic(entry.slug)}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
              topic === entry.slug
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border/80 text-muted-foreground hover:text-foreground",
            )}
          >
            {entry.label}
            <span className="ml-1.5 text-muted-foreground/80">{entry.count}</span>
          </Link>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/80 px-2 py-0.5 font-mono text-[0.68rem]">
          <Sparkles className="size-3" />
          {response.mode === "hybrid"
            ? "vector + keyword"
            : response.mode === "keyword"
              ? "keyword only"
              : "most recent"}
        </span>
        <span>
          {response.total.toLocaleString()} result{response.total === 1 ? "" : "s"}
          {query ? ` for “${query}”` : ""}
          {topic ? ` in ${topicLabel(topic)}` : ""} · {response.tookMs}ms
        </span>
      </div>

      {response.notice && (
        <p className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {response.notice}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-3">
        {response.results.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              No saved sites matched {query ? `“${query}”` : "that filter"}.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              Try a broader phrase, or{" "}
              <Link href="/topics" className="underline underline-offset-4">
                browse by topic
              </Link>
              .
            </p>
          </div>
        ) : (
          response.results.map((result) => (
            <LinkCard
              key={result.link.id}
              link={result.link}
              query={query}
              evidence={result.matchedIn === "page" ? result.snippet : undefined}
              badge={
                <span className="font-mono text-[0.65rem] text-muted-foreground">
                  {MATCH_LABELS[result.matchedIn] ?? result.matchedIn}
                </span>
              }
            />
          ))
        )}
      </div>
    </div>
  );
}
