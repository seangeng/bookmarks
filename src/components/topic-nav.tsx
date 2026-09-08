import { Search } from "lucide-react";
import Link from "next/link";

import { topicLabel } from "@/lib/topics";

export function TopicNav({ topics }: { topics: string[] }) {
  return (
    <nav className="flex items-center gap-0.5 text-sm">
      {topics.slice(0, 3).map((slug) => (
        <Link
          key={slug}
          href={`/topics/${slug}`}
          className="hidden rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:block"
        >
          {topicLabel(slug)}
        </Link>
      ))}
      <Link
        href="/topics"
        className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        Topics
      </Link>
      <Link
        href="/search"
        aria-label="Search bookmarks"
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Search className="size-3.5" />
        <span className="sr-only sm:not-sr-only">Search</span>
      </Link>
    </nav>
  );
}
