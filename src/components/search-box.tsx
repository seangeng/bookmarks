"use client";

import { Loader2, Search, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { cn } from "cn";

import { topicLabel } from "@/lib/topics";

type InstantResult = {
  id: string;
  author: { name: string; handle: string };
  topics: string[];
  domain: string | null;
  snippet: string;
  matched_in: string;
};

type InstantResponse = {
  query: string;
  mode: string;
  total: number;
  took_ms: number;
  results: InstantResult[];
};

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 180;

type SearchBoxProps = {
  initialQuery?: string;
  topic?: string;
  size?: "default" | "lg";
  placeholder?: string;
  className?: string;
  /** The instant dropdown helps on the home page and is noise on /search. */
  instant?: boolean;
};

export function SearchBox({
  initialQuery = "",
  topic,
  size = "default",
  placeholder = "Search bookmarks, links, and crawled pages…",
  className,
  instant = true,
}: SearchBoxProps) {
  const router = useRouter();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [response, setResponse] = useState<InstantResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [active, setActive] = useState(-1);

  const trimmed = query.trim();

  const target = useCallback(
    (value: string) => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      if (topic) params.set("topic", topic);
      const suffix = params.toString();
      return suffix ? `/search?${suffix}` : "/search";
    },
    [topic],
  );

  useEffect(() => {
    if (!instant || trimmed.length < MIN_QUERY_LENGTH) return;

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "6" });
        if (topic) params.set("topic", topic);
        const request = await fetch(`/api/search?${params}`, { signal: controller.signal });
        if (!request.ok) throw new Error(`Search failed: ${request.status}`);
        const payload = (await request.json()) as InstantResponse;
        setResponse(payload);
        setActive(-1);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResponse(null);
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [trimmed, topic, instant]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (event.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Only show results that belong to what is currently in the box.
  const fresh = response?.query === trimmed ? response : null;
  const results = fresh?.results ?? [];
  const open = instant && focused && !dismissed && results.length > 0;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setDismissed(true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const chosen = open ? results[active] : undefined;
      router.push(chosen ? `/b/${chosen.id}` : target(query));
      setDismissed(true);
      return;
    }
    if (!open) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => (current + 1) % results.length);
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => (current <= 0 ? results.length - 1 : current - 1));
    }
  };

  return (
    <div className={cn("relative", className)}>
      <form
        role="search"
        action="/search"
        onSubmit={(event) => {
          event.preventDefault();
          router.push(target(query));
          setDismissed(true);
        }}
      >
        {topic && <input type="hidden" name="topic" value={topic} />}
        <div className="relative">
          <Search
            className={cn(
              "pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground",
              size === "lg" ? "size-4" : "size-3.5",
            )}
          />
          <input
            ref={inputRef}
            type="search"
            name="q"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setDismissed(false);
            }}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 120)}
            placeholder={placeholder}
            autoComplete="off"
            role={instant ? "combobox" : undefined}
            aria-label="Search bookmarks"
            aria-expanded={instant ? open : undefined}
            aria-controls={instant ? listId : undefined}
            aria-autocomplete={instant ? "list" : undefined}
            className={cn(
              "w-full rounded-xl border border-border bg-card/80 pr-14 font-sans text-foreground shadow-xs transition-colors placeholder:text-muted-foreground/80 focus-visible:border-primary/50 focus-visible:ring-3 focus-visible:ring-primary/20 focus-visible:outline-none",
              size === "lg" ? "h-12 pl-10 text-base" : "h-10 pl-9 text-sm",
            )}
          />
          <div className="absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-2">
            {loading ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : (
              <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground sm:block">
                /
              </kbd>
            )}
          </div>
        </div>
      </form>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-popover/95 shadow-lg backdrop-blur-md"
        >
          {results.map((result, index) => (
            <li key={result.id} role="option" aria-selected={index === active}>
              <a
                href={`/b/${result.id}`}
                onMouseEnter={() => setActive(index)}
                className={cn(
                  "flex flex-col gap-1 border-b border-border/60 px-3.5 py-2.5 transition-colors last:border-b-0",
                  index === active ? "bg-muted" : "hover:bg-muted/60",
                )}
              >
                <span className="line-clamp-2 text-[0.82rem] leading-snug">{result.snippet}</span>
                <span className="flex items-center gap-2 font-mono text-[0.65rem] text-muted-foreground">
                  <span>@{result.author.handle}</span>
                  {result.domain && <span className="truncate">{result.domain}</span>}
                  <span className="ml-auto shrink-0">
                    {result.topics.map(topicLabel).slice(0, 2).join(" · ")}
                  </span>
                </span>
              </a>
            </li>
          ))}
          <li className="flex items-center justify-between gap-2 bg-muted/40 px-3.5 py-2 text-[0.7rem] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Sparkles className="size-3" />
              {fresh?.mode === "hybrid" ? "hybrid vector + keyword" : "keyword"} · {fresh?.took_ms}ms
            </span>
            <a
              href={target(query)}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              All {fresh?.total ?? 0} results
            </a>
          </li>
        </ul>
      )}
    </div>
  );
}
