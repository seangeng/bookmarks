import { ArrowUpRight, FileWarning, Link2 } from "lucide-react";
import Link from "next/link";
import { cn } from "cn";

import { Highlight } from "@/components/highlight";
import { TopicChip } from "@/components/topic-chip";
import { formatDate, postBody, relativeDate, truncate } from "@/lib/text";
import type { BookmarkLink, IndexedBookmark } from "@/lib/types";

function LinkRow({ link }: { link: BookmarkLink }) {
  const crawl = link.crawl;
  const failed = crawl && crawl.status !== "ok";

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noreferrer nofollow"
      className="group/link flex items-start gap-2.5 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 transition-colors hover:border-primary/35 hover:bg-muted/70"
    >
      {failed ? (
        <FileWarning className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <Link2 className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[0.8rem] font-medium">
            {crawl?.title ?? link.domain}
          </span>
          <ArrowUpRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/link:opacity-100" />
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[0.68rem] text-muted-foreground">
          {link.domain}
          {crawl?.word_count ? <span>· {crawl.word_count.toLocaleString()} words</span> : null}
          {failed ? <span>· not archived</span> : null}
        </span>
      </span>
    </a>
  );
}

type BookmarkCardProps = {
  bookmark: IndexedBookmark;
  query?: string;
  /**
   * Matched text from a crawled page. Shown *below* the post rather than in
   * place of it, so a result still reads as "what Sean saved" first.
   */
  evidence?: string;
  evidenceSource?: string;
  /** Rendered on the right of the meta row, e.g. the search match badge. */
  badge?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

export function BookmarkCard({
  bookmark,
  query,
  evidence,
  evidenceSource,
  badge,
  className,
  compact = false,
}: BookmarkCardProps) {
  const { body, linkOnly } = postBody(bookmark.text, bookmark.summary);
  const links = compact ? bookmark.links.slice(0, 1) : bookmark.links.slice(0, 2);

  return (
    <article
      className={cn(
        "group relative rounded-xl border border-border/70 bg-card/70 p-4 transition-colors hover:border-primary/30 hover:bg-card",
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Link
          href={`/b/${bookmark.id}`}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {bookmark.author.name}
        </Link>
        <span className="font-mono text-[0.7rem]">@{bookmark.author.handle}</span>
        <time dateTime={bookmark.created_at} title={formatDate(bookmark.created_at)}>
          {relativeDate(bookmark.created_at)}
        </time>
        {badge ? <span className="ml-auto">{badge}</span> : null}
      </div>

      <Link href={`/b/${bookmark.id}`} className="mt-2 block">
        {linkOnly ? (
          <p className="text-sm text-muted-foreground italic">
            Link-only post — the export didn’t include the destination.
          </p>
        ) : (
          <p
            className={cn(
              "font-heading leading-snug text-foreground/95",
              compact ? "text-[0.95rem]" : "text-[1.05rem]",
            )}
          >
            <Highlight text={compact ? truncate(body, 180) : truncate(body, 420)} query={query} />
          </p>
        )}
      </Link>

      {evidence && (
        <div className="mt-3 border-l-2 border-primary/30 pl-3">
          {evidenceSource && (
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-muted-foreground/80">
              matched in {evidenceSource}
            </p>
          )}
          <p className="mt-0.5 text-[0.82rem] leading-relaxed text-muted-foreground">
            <Highlight text={evidence} query={query} />
          </p>
        </div>
      )}

      {links.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {links.map((link) => (
            <LinkRow key={link.url} link={link} />
          ))}
          {bookmark.links.length > links.length && (
            <Link
              href={`/b/${bookmark.id}`}
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              +{bookmark.links.length - links.length} more link
              {bookmark.links.length - links.length === 1 ? "" : "s"}
            </Link>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {bookmark.topics.map((topic) => (
          <TopicChip key={topic} slug={topic} />
        ))}
      </div>
    </article>
  );
}
