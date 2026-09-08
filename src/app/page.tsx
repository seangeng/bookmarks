import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { LinkList } from "@/components/link-list";
import { SearchBox } from "@/components/search-box";
import { TopicChip } from "@/components/topic-chip";
import { getRecentLinks, getStats, getTopicSummaries, indexMeta } from "@/lib/library";
import { formatDate } from "@/lib/text";

const SUGGESTIONS = [
  "ui components",
  "coding agents",
  "shaders",
  "design systems",
  "self-hosting",
];

export default function HomePage() {
  const stats = getStats();
  const topics = getTopicSummaries().sort((a, b) => b.count - a.count);
  const recent = getRecentLinks(10);

  return (
    <div className="page-glow">
      <section className="mx-auto max-w-5xl px-5 pt-14 pb-10 sm:pt-20">
        <p className="font-mono text-[0.7rem] uppercase tracking-[0.18em] text-muted-foreground">
          bookmarks.seangeng.com
        </p>
        <h1 className="mt-3 max-w-2xl font-heading text-4xl leading-[1.1] tracking-tight sm:text-5xl">
          A library of the sites
          <span className="text-muted-foreground italic"> worth keeping.</span>
        </h1>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
          {stats.links.toLocaleString()} pages saved from {stats.domains.toLocaleString()} sites,{" "}
          {stats.archived.toLocaleString()} of them crawled and archived
          {stats.words > 0 && ` (${Math.round(stats.words / 1000)}k words)`}. Search runs over each
          page&rsquo;s own title and text, not over anything said about it.
        </p>

        <div className="mt-7 max-w-2xl">
          <SearchBox size="lg" />
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-xs text-muted-foreground">
            <span>Try</span>
            {SUGGESTIONS.map((suggestion) => (
              <Link
                key={suggestion}
                href={`/search?q=${encodeURIComponent(suggestion)}`}
                className="rounded-full border border-border/80 px-2.5 py-1 transition-colors hover:border-primary/40 hover:text-foreground"
              >
                {suggestion}
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-heading text-xl tracking-tight">Browse by topic</h2>
          <Link
            href="/topics"
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            All topics <ArrowRight className="size-3" />
          </Link>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {topics.map((topic) => (
            <Link
              key={topic.slug}
              href={`/topics/${topic.slug}`}
              className="group relative flex flex-col gap-2 overflow-hidden rounded-xl border border-border/70 bg-card/60 p-4 transition-colors hover:border-primary/30 hover:bg-card"
            >
              <span
                className="absolute inset-x-0 top-0 h-px opacity-70"
                style={{ background: topic.color }}
                aria-hidden="true"
              />
              <span className="flex items-center justify-between gap-2">
                <span className="font-heading text-base">{topic.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{topic.count}</span>
              </span>
              <span className="text-xs leading-relaxed text-muted-foreground">{topic.blurb}</span>
              {topic.domains.length > 0 && (
                <span className="mt-1 truncate font-mono text-[0.65rem] text-muted-foreground/80">
                  {topic.domains.join(" · ")}
                </span>
              )}
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 py-6">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-heading text-xl tracking-tight">Recently saved</h2>
          <span className="font-mono text-[0.7rem] text-muted-foreground">
            indexed {formatDate(indexMeta.generated_at)}
          </span>
        </div>
        <div className="mt-4">
          <LinkList links={recent} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Jump to a topic:</span>
          {topics.map((topic) => (
            <TopicChip key={topic.slug} slug={topic.slug} count={topic.count} />
          ))}
        </div>
      </section>
    </div>
  );
}
