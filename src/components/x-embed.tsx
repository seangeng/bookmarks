"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    twttr?: {
      widgets?: { load: (element?: HTMLElement) => void };
    };
  }
}

const SCRIPT_ID = "twitter-widgets";
const SCRIPT_SRC = "https://platform.twitter.com/widgets.js";

function loadWidgets(): Promise<void> {
  if (window.twttr?.widgets) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("widgets.js failed")), {
        once: true,
      });
      return;
    }
    const script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("widgets.js failed"));
    document.head.append(script);
  });
}

/**
 * Renders the real X embed on demand. It stays opt-in because widgets.js is
 * third-party, frequently blocked, and not worth loading on every page view —
 * the page already shows the post text without it.
 */
export function XEmbed({ url }: { url: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  useEffect(() => {
    if (state !== "loading") return;
    let cancelled = false;

    loadWidgets()
      .then(() => {
        if (cancelled || !container.current) return;
        window.twttr?.widgets?.load(container.current);
        setState("ready");
      })
      .catch(() => !cancelled && setState("error"));

    return () => {
      cancelled = true;
    };
  }, [state]);

  if (state === "idle") {
    return (
      <Button variant="outline" size="sm" onClick={() => setState("loading")}>
        Load embedded post
      </Button>
    );
  }

  if (state === "error") {
    return (
      <p className="text-xs text-muted-foreground">
        The X embed could not load (likely blocked).{" "}
        <a href={url} className="underline underline-offset-4" target="_blank" rel="noreferrer">
          Open on X
        </a>
        .
      </p>
    );
  }

  return (
    <div ref={container} className="min-h-16 [&_.twitter-tweet]:!my-0">
      {state === "loading" && (
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Loading embed…
        </span>
      )}
      <blockquote className="twitter-tweet" data-dnt="true" data-theme="dark">
        <a href={url}>{url}</a>
      </blockquote>
    </div>
  );
}
