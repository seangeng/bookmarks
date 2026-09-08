import { Library } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { TopicNav } from "@/components/topic-nav";
import { getPopulatedTopicSlugs } from "@/lib/library";

export function SiteHeader() {
  const topics = getPopulatedTopicSlugs();

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-5">
        <Link
          href="/"
          className="group flex items-center gap-2 text-sm font-medium tracking-tight"
        >
          <span className="grid size-7 place-items-center rounded-md bg-primary/12 text-primary ring-1 ring-primary/25">
            <Library className="size-3.5" />
          </span>
          <span className="font-heading text-base leading-none">
            Bookmarks
            <span className="hidden text-muted-foreground sm:inline"> · Sean Geng</span>
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-1">
          <TopicNav topics={topics} />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
