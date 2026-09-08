import Link from "next/link";
import { cn } from "cn";

import { TOPIC_BY_SLUG, type TopicSlug } from "@/lib/topics";

type TopicChipProps = {
  slug: string;
  count?: number;
  className?: string;
  asLink?: boolean;
};

export function TopicChip({ slug, count, className, asLink = true }: TopicChipProps) {
  const topic = TOPIC_BY_SLUG.get(slug as TopicSlug);
  if (!topic) return null;

  const content = (
    <>
      <span
        className="size-1.5 rounded-full"
        style={{ background: topic.color }}
        aria-hidden="true"
      />
      {topic.label}
      {count !== undefined && (
        <span className="text-[0.7rem] text-muted-foreground">{count}</span>
      )}
    </>
  );

  const classes = cn(
    "topic-chip inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
    asLink && "hover:brightness-115",
    className,
  );
  const style = { "--chip": topic.color } as React.CSSProperties;

  if (!asLink) {
    return (
      <span className={classes} style={style}>
        {content}
      </span>
    );
  }

  return (
    <Link href={`/topics/${topic.slug}`} className={classes} style={style}>
      {content}
    </Link>
  );
}
