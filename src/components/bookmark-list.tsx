import { BookmarkCard } from "@/components/bookmark-card";
import type { IndexedBookmark } from "@/lib/types";

type BookmarkListProps = {
  bookmarks: IndexedBookmark[];
  query?: string;
  emptyMessage?: string;
};

export function BookmarkList({ bookmarks, query, emptyMessage }: BookmarkListProps) {
  if (bookmarks.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        {emptyMessage ?? "Nothing here yet."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {bookmarks.map((bookmark) => (
        <BookmarkCard key={bookmark.id} bookmark={bookmark} query={query} />
      ))}
    </div>
  );
}
