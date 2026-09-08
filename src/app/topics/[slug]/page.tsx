import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { BookmarkList } from "@/components/bookmark-list";
import { SearchBox } from "@/components/search-box";
import { getBookmarksByTopic, getTopic } from "@/lib/library";
import { TOPICS } from "@/lib/topics";

type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return TOPICS.map((topic) => ({ slug: topic.slug }));
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic) return { title: "Topic not found" };
  return {
    title: topic.label,
    description: `${topic.count} bookmarks filed under ${topic.label}. ${topic.blurb}`,
  };
}

export default async function TopicPage({ params }: { params: Params }) {
  const { slug } = await params;
  const topic = getTopic(slug);
  if (!topic) notFound();

  const bookmarks = getBookmarksByTopic(slug);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <nav className="text-xs text-muted-foreground">
        <Link href="/topics" className="underline-offset-4 hover:text-foreground hover:underline">
          Topics
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-foreground">{topic.label}</span>
      </nav>

      <div className="mt-3 flex items-center gap-3">
        <span
          className="size-3 rounded-full"
          style={{ background: topic.color }}
          aria-hidden="true"
        />
        <h1 className="font-heading text-3xl tracking-tight">{topic.label}</h1>
        <span className="font-mono text-sm text-muted-foreground">{topic.count}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{topic.blurb}</p>

      {topic.domains.length > 0 && (
        <p className="mt-2 font-mono text-[0.7rem] text-muted-foreground/80">
          Most-linked: {topic.domains.join(" · ")}
        </p>
      )}

      <div className="mt-6">
        <SearchBox
          topic={slug}
          placeholder={`Search within ${topic.label}…`}
          instant={false}
        />
      </div>

      <div className="mt-6">
        <BookmarkList
          bookmarks={bookmarks}
          emptyMessage={`Nothing filed under ${topic.label} yet. The next sync may change that.`}
        />
      </div>
    </div>
  );
}
