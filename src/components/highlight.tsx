import { highlightRuns } from "@/lib/text";

/** Wraps query-term matches in <mark> without dangerouslySetInnerHTML. */
export function Highlight({ text, query }: { text: string; query?: string }) {
  if (!query?.trim()) return <>{text}</>;

  return (
    <>
      {highlightRuns(text, query).map((run, index) =>
        run.match ? <mark key={index}>{run.text}</mark> : <span key={index}>{run.text}</span>,
      )}
    </>
  );
}
