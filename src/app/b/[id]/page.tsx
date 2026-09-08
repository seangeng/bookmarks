import { ArrowUpRight, Clock, FileText, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookmarkCard } from "@/components/bookmark-card";
import { PostText } from "@/components/post-text";
import { TopicChip } from "@/components/topic-chip";
import { XEmbed } from "@/components/x-embed";
import { getBookmark, getRelatedBookmarks, getAllBookmarks } from "@/lib/library";
import { formatDate, postBody, truncate } from "@/lib/text";
import type { BookmarkLink } from "@/lib/types";

type Params = Promise<{ id: string }>;

const CRAWL_STATUS_COPY: Record<string, string> = {
  ok: "archived",
  empty: "no extractable text",
  unsupported_type: "not HTML",
  http_error: "server refused",
  network_error: "unreachable",
  timeout: "timed out",
  blocked_by_robots: "disallowed by robots.txt",
  skipped: "skipped",
};

export function generateStaticParams() {
  return getAllBookmarks().map((bookmark) => ({ id: bookmark.id }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const bookmark = getBookmark(id);
  if (!bookmark) return { title: "Bookmark not found" };
  return {
    title: truncate(bookmark.summary || bookmark.text, 70),
    description: truncate(bookmark.summary || bookmark.text, 180),
  };
}

function LinkArchive({ link }: { link: BookmarkLink }) {
  const crawl = link.crawl;
  const ok = crawl?.status === "ok";

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <a
            href={link.url}
            target="_blank"
            rel="noreferrer nofollow"
            className="group flex items-center gap-1.5 font-heading text-base leading-snug"
          >
            <span className="underline-offset-4 group-hover:underline">
              {crawl?.title ?? link.url}
            </span>
            <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground" />
          </a>
          <p className="mt-1 font-mono text-[0.68rem] text-muted-foreground">
            {crawl?.site_name &&
            crawl.site_name.toLowerCase() !== link.domain.toLowerCase()
              ? `${crawl.site_name} · ${link.domain}`
              : link.domain}
            {link.via && ` · via ${link.via.replace(/^https?:\/\//, "")}`}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[0.62rem] ${
            ok
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          {CRAWL_STATUS_COPY[crawl?.status ?? "skipped"] ?? crawl?.status ?? "not crawled"}
        </span>
      </div>

      {crawl?.description && (
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{crawl.description}</p>
      )}

      {crawl?.excerpt && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
            <FileText className="size-3.5" />
            Crawled excerpt
            {crawl.word_count ? ` · ${crawl.word_count.toLocaleString()} words` : ""}
          </summary>
          <div className="crawl-prose mt-2 border-l-2 border-border pl-3">
            {crawl.excerpt.split("\n\n").map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </details>
      )}

      {!ok && crawl?.error && (
        <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {crawl.error}
        </p>
      )}

      {crawl?.fetched_at && (
        <p className="mt-3 flex items-center gap-1.5 font-mono text-[0.62rem] text-muted-foreground/80">
          <Clock className="size-3" />
          crawled {formatDate(crawl.fetched_at)}
        </p>
      )}
    </div>
  );
}

export default async function BookmarkPage({ params }: { params: Params }) {
  const { id } = await params;
  const bookmark = getBookmark(id);
  if (!bookmark) notFound();

  const related = getRelatedBookmarks(bookmark, 4);
  const body = postBody(bookmark.text, bookmark.summary);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <nav className="text-xs text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
          Library
        </Link>
        {bookmark.topics[0] && (
          <>
            <span className="mx-1.5">/</span>
            <Link
              href={`/topics/${bookmark.topics[0]}`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {bookmark.topics[0]}
            </Link>
          </>
        )}
      </nav>

      <article className="mt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{bookmark.author.name}</span>
          <a
            href={`https://x.com/${bookmark.author.handle}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-xs underline-offset-4 hover:text-foreground hover:underline"
          >
            @{bookmark.author.handle}
          </a>
          <span aria-hidden="true">·</span>
          <time dateTime={bookmark.created_at} className="text-xs">
            {formatDate(bookmark.created_at)}
          </time>
        </div>

        {body.linkOnly ? (
          <p className="mt-4 text-base text-muted-foreground italic">
            Link-only post — the export didn’t include the destination, so there is nothing
            archived for it.
          </p>
        ) : (
          <p className="mt-4 font-heading text-2xl leading-snug tracking-tight whitespace-pre-wrap">
            <PostText text={body.body} />
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {bookmark.topics.map((topic) => (
            <TopicChip key={topic} slug={topic} />
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <a
            href={bookmark.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-muted"
          >
            View on X <ArrowUpRight className="size-3" />
          </a>
          <XEmbed url={bookmark.url} />
        </div>
      </article>

      {bookmark.links.length > 0 && (
        <section className="mt-9">
          <h2 className="font-heading text-lg tracking-tight">
            {bookmark.links.length === 1 ? "Linked page" : `Linked pages (${bookmark.links.length})`}
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            {bookmark.links.map((link) => (
              <LinkArchive key={link.url} link={link} />
            ))}
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="font-heading text-lg tracking-tight">Related</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nearest neighbours by embedding distance, computed at index time.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {related.map((entry) => (
              <BookmarkCard key={entry.id} bookmark={entry} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
