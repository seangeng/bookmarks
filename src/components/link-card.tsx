import { ArrowUpRight, FileWarning } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

import { Highlight } from "@/components/highlight";
import { TopicChip } from "@/components/topic-chip";
import { formatDate, prettyUrl, relativeDate, truncate } from "@/lib/text";
import type { LibraryLink } from "@/lib/types";

/** Short label for pages the crawler could not read. */
const STATUS_COPY: Record<string, string> = {
  empty: "no readable text",
  unsupported_type: "not HTML",
  http_error: "server refused",
  network_error: "unreachable",
  timeout: "timed out",
  blocked_by_robots: "crawling disallowed",
  skipped: "not crawled",
  not_crawled: "not crawled",
};

type LinkCardProps = {
  link: LibraryLink;
  query?: string;
  /** Matched text from the page body, shown beneath the description. */
  evidence?: string;
  badge?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

export function LinkCard({
  link,
  query,
  evidence,
  badge,
  className,
  compact = false,
}: LinkCardProps) {
  const archived = link.status === "ok";
  const blurb = link.description ?? link.excerpt ?? "";

  return (
    <article
      className={cn(
        "group relative rounded-xl border border-border/70 bg-card/70 p-4 transition-colors hover:border-primary/30 hover:bg-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 font-mono text-[0.68rem] text-muted-foreground">
        <span className="truncate">{link.domain}</span>
        <time dateTime={link.saved_at} title={`Saved ${formatDate(link.saved_at)}`}>
          {relativeDate(link.saved_at)}
        </time>
        {!archived && (
          <span className="inline-flex items-center gap-1 text-muted-foreground/90">
            <FileWarning className="size-3" />
            {STATUS_COPY[link.status] ?? link.status}
          </span>
        )}
        {badge ? <span className="ml-auto shrink-0">{badge}</span> : null}
      </div>

      <Link href={`/s/${link.id}`} className="mt-1.5 block">
        <h3
          className={cn(
            "font-heading leading-snug text-foreground/95 underline-offset-4 group-hover:underline",
            compact ? "text-[0.95rem]" : "text-[1.1rem]",
          )}
        >
          <Highlight text={truncate(link.title, 140)} query={query} />
        </h3>
      </Link>

      {blurb && (
        <p className="mt-1.5 text-[0.85rem] leading-relaxed text-muted-foreground">
          <Highlight text={truncate(blurb, compact ? 130 : 260)} query={query} />
        </p>
      )}

      {evidence && (
        <div className="mt-2.5 border-l-2 border-primary/30 pl-3">
          <p className="text-[0.8rem] leading-relaxed text-muted-foreground">
            <Highlight text={evidence} query={query} />
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {link.topics.map((topic) => (
            <TopicChip key={topic} slug={topic} />
          ))}
        </div>
        <a
          href={link.url}
          target="_blank"
          rel="noreferrer nofollow"
          className="ml-auto inline-flex items-center gap-1 font-mono text-[0.68rem] text-muted-foreground transition-colors hover:text-primary"
        >
          {prettyUrl(link.url, compact ? 32 : 46)}
          <ArrowUpRight className="size-3" />
        </a>
      </div>
    </article>
  );
}
