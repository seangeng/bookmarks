import { ArrowUpRight, Clock, FileText, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { LinkCard } from "@/components/link-card";
import { TopicChip } from "@/components/topic-chip";
import { getAllLinks, getLink, getRelatedLinks } from "@/lib/library";
import { formatDate, prettyUrl, truncate } from "@/lib/text";

type Params = Promise<{ id: string }>;

const STATUS_COPY: Record<string, string> = {
  ok: "archived",
  empty: "no readable text",
  unsupported_type: "not HTML",
  http_error: "server refused",
  network_error: "unreachable",
  timeout: "timed out",
  blocked_by_robots: "crawling disallowed",
  skipped: "not crawled",
  not_crawled: "not crawled",
};

export function generateStaticParams() {
  return getAllLinks().map((link) => ({ id: link.id }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { id } = await params;
  const link = getLink(id);
  if (!link) return { title: "Not found" };
  return {
    title: truncate(link.title, 70),
    description: truncate(link.description ?? link.excerpt ?? link.title, 180),
  };
}

export default async function SitePage({ params }: { params: Params }) {
  const { id } = await params;
  const link = getLink(id);
  if (!link) notFound();

  const related = getRelatedLinks(link, 4);
  const archived = link.status === "ok";

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <nav className="text-xs text-muted-foreground">
        <Link href="/" className="underline-offset-4 hover:text-foreground hover:underline">
          Library
        </Link>
        {link.topics[0] && (
          <>
            <span className="mx-1.5">/</span>
            <Link
              href={`/topics/${link.topics[0]}`}
              className="underline-offset-4 hover:text-foreground hover:underline"
            >
              {link.topics[0]}
            </Link>
          </>
        )}
      </nav>

      <article className="mt-4">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.7rem] text-muted-foreground">
          <span>{link.site_name && link.site_name.toLowerCase() !== link.domain.toLowerCase()
            ? `${link.site_name} · ${link.domain}`
            : link.domain}</span>
          <span aria-hidden="true">·</span>
          <span>saved {formatDate(link.saved_at)}</span>
          {link.published_at && (
            <>
              <span aria-hidden="true">·</span>
              <span>published {formatDate(link.published_at)}</span>
            </>
          )}
          <span
            className={`rounded-full border px-2 py-0.5 text-[0.62rem] ${
              archived
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border text-muted-foreground"
            }`}
          >
            {STATUS_COPY[link.status] ?? link.status}
          </span>
        </div>

        <h1 className="mt-3 font-heading text-3xl leading-tight tracking-tight">{link.title}</h1>

        {link.description && (
          <p className="mt-3 text-base leading-relaxed text-foreground/85">{link.description}</p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-1.5">
          {link.topics.map((topic) => (
            <TopicChip key={topic} slug={topic} />
          ))}
        </div>

        <a
          href={link.url}
          target="_blank"
          rel="noreferrer nofollow"
          className="mt-5 inline-flex h-9 max-w-full items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium transition-colors hover:border-primary/40 hover:bg-muted"
        >
          <span className="truncate font-mono">{prettyUrl(link.url, 56)}</span>
          <ArrowUpRight className="size-3.5 shrink-0" />
        </a>

        {!archived && link.error && (
          <p className="mt-4 flex items-start gap-1.5 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            {link.error}
          </p>
        )}
      </article>

      {link.excerpt && (
        <section className="mt-9">
          <h2 className="flex items-center gap-1.5 font-heading text-lg tracking-tight">
            <FileText className="size-4 text-muted-foreground" />
            Archived text
            {link.word_count > 0 && (
              <span className="font-mono text-xs font-normal text-muted-foreground">
                {link.word_count.toLocaleString()} words
              </span>
            )}
          </h2>
          <div className="crawl-prose mt-3 border-l-2 border-border pl-4">
            {link.excerpt.split("\n\n").map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
          {link.fetched_at && (
            <p className="mt-3 flex items-center gap-1.5 font-mono text-[0.62rem] text-muted-foreground/80">
              <Clock className="size-3" />
              crawled {formatDate(link.fetched_at)}
            </p>
          )}
        </section>
      )}

      {related.length > 0 && (
        <section className="mt-10">
          <h2 className="font-heading text-lg tracking-tight">Related sites</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Nearest neighbours by embedding distance, computed at index time.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            {related.map((entry) => (
              <LinkCard key={entry.id} link={entry} compact />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
