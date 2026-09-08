import Link from "next/link";

import { getStats, indexMeta } from "@/lib/library";
import { formatDate, pluralize } from "@/lib/text";

export function SiteFooter() {
  const stats = getStats();

  return (
    <footer className="mt-20 border-t border-border/70">
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-5 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="leading-relaxed">
          {pluralize(stats.bookmarks, "bookmark")} · {pluralize(stats.links, "link")} ·{" "}
          {stats.crawled} crawled · indexed {formatDate(indexMeta.generated_at)}
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="font-mono text-[11px]">
            {indexMeta.embedding.provider}/{indexMeta.embedding.model} ·{" "}
            {indexMeta.embedding.dimensions}d · {indexMeta.vector_store}
          </span>
          <Link href="/topics" className="underline-offset-4 hover:text-foreground hover:underline">
            Topics
          </Link>
          <a
            href="https://github.com/seangeng/bookmarks"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Source
          </a>
          <a
            href="https://x.com/seangeng"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            @seangeng
          </a>
        </p>
      </div>
    </footer>
  );
}
