import type { Metadata } from "next";
import Link from "next/link";

import { getTopicSummaries } from "@/lib/library";
import { relativeDate } from "@/lib/text";

export const metadata: Metadata = {
  title: "Topics",
  description: "Browse the library of saved sites by topic.",
};

export default function TopicsPage() {
  const topics = getTopicSummaries({ includeEmpty: true }).sort((a, b) => b.count - a.count);

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <h1 className="font-heading text-2xl tracking-tight">Topics</h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Topics are assigned during indexing from each page&rsquo;s own crawled title, description,
        body text, and domain — by LLM when an API key is configured, otherwise by a weighted
        keyword classifier. A site can sit in up to three.
      </p>

      <div className="mt-6 flex flex-col divide-y divide-border/70 border-y border-border/70">
        {topics.map((topic) => (
          <Link
            key={topic.slug}
            href={`/topics/${topic.slug}`}
            className="group flex items-start gap-4 py-4 transition-colors hover:bg-muted/40"
          >
            <span
              className="mt-1.5 size-2.5 shrink-0 rounded-full"
              style={{ background: topic.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="font-heading text-lg">{topic.label}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {topic.count} site{topic.count === 1 ? "" : "s"}
                </span>
                {topic.latest && (
                  <span className="ml-auto shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                    updated {relativeDate(topic.latest.saved_at)}
                  </span>
                )}
              </span>
              <span className="mt-1 block text-sm text-muted-foreground">{topic.blurb}</span>
              {topic.domains.length > 0 && (
                <span className="mt-1.5 block truncate font-mono text-[0.65rem] text-muted-foreground/80">
                  {topic.domains.join(" · ")}
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
