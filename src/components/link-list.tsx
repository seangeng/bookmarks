import { LinkCard } from "@/components/link-card";
import type { LibraryLink } from "@/lib/types";

type LinkListProps = {
  links: LibraryLink[];
  query?: string;
  emptyMessage?: string;
};

export function LinkList({ links, query, emptyMessage }: LinkListProps) {
  if (links.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        {emptyMessage ?? "Nothing here yet."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {links.map((link) => (
        <LinkCard key={link.id} link={link} query={query} />
      ))}
    </div>
  );
}
