const PATTERN = /(https?:\/\/[^\s<>"')]+)|(?<![\w@])@([A-Za-z0-9_]{1,15})\b/g;

const linkClass = "text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary";

/**
 * Renders post text with URLs and @mentions turned into links. Used on the
 * bookmark detail page, where the full text is shown; cards stay plain so the
 * whole card remains one click target.
 */
export function PostText({ text }: { text: string }) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(text.slice(cursor, index));

    const [raw, url, handle] = match;
    if (url) {
      nodes.push(
        <a
          key={index}
          href={url}
          target="_blank"
          rel="noreferrer nofollow"
          className={linkClass}
        >
          {url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
        </a>,
      );
    } else {
      nodes.push(
        <a
          key={index}
          href={`https://x.com/${handle}`}
          target="_blank"
          rel="noreferrer"
          className={linkClass}
        >
          {raw}
        </a>,
      );
    }
    cursor = index + raw.length;
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
