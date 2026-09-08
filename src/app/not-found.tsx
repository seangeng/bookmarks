import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-start px-5 py-24">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">404</p>
      <h1 className="mt-3 font-heading text-3xl tracking-tight">Not in the library</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        That bookmark or topic doesn’t exist — it may have dropped out of the latest export.
      </p>
      <div className="mt-6 flex gap-3 text-sm">
        <Link
          href="/"
          className="inline-flex h-8 items-center rounded-lg bg-primary px-3 font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Back to the library
        </Link>
        <Link
          href="/topics"
          className="inline-flex h-8 items-center rounded-lg border border-border px-3 font-medium transition-colors hover:bg-muted"
        >
          Browse topics
        </Link>
      </div>
    </div>
  );
}
