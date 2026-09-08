import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { parseRobots, pathAllowed } from "../scripts/lib/crawler";
import { extractArticle } from "../scripts/lib/extract";
import { readSeed } from "../scripts/lib/seed";
import { cosineSimilarity, localEmbed } from "../src/lib/embeddings";
import { normalizeBookmark, normalizeExport } from "../src/lib/normalize";
import { normalizeUrl, postBody, snippetFor, stripShortenerUrls, terms } from "../src/lib/text";
import { pickTopics, scoreTopics, toTopicSlug } from "../src/lib/topics";

/* ------------------------------------------------------- export adapter */

test("normalizeExport accepts the shapes an X export can arrive in", () => {
  const bookmark = {
    id: "1",
    text: "hello",
    author: { name: "A", handle: "a" },
    url: "https://x.com/a/status/1",
    created_at: "2026-01-01T00:00:00.000Z",
  };

  for (const shape of [[bookmark], { bookmarks: [bookmark] }, { data: [bookmark] }]) {
    assert.equal(normalizeExport(shape).bookmarks.length, 1, JSON.stringify(shape));
  }
});

test("normalizeBookmark reads X API v2 field names", () => {
  const result = normalizeBookmark({
    rest_id: "1799",
    core: { name: "Ada", screen_name: "@ada" },
    legacy: {
      full_text: "graph theory notes https://t.co/abc",
      created_at: "Wed Oct 10 20:19:24 +0000 2018",
    },
    entities: { urls: [{ url: "https://t.co/abc", expanded_url: "https://example.com/notes?utm_source=x" }] },
  });

  assert.ok(result);
  assert.equal(result.id, "1799");
  assert.equal(result.author.handle, "ada", "leading @ should be stripped");
  assert.equal(result.author.name, "Ada");
  assert.equal(result.created_at, "2018-10-10T20:19:24.000Z");
  assert.deepEqual(result.external_urls, ["https://example.com/notes"], "t.co and utm dropped");
  assert.equal(result.url, "https://x.com/ada/status/1799", "post URL derived when absent");
});

test("normalizeBookmark reads the flat export field names", () => {
  const result = normalizeBookmark({
    id: "42",
    text: "flat shape",
    author_username: "seangeng",
    author_name: "Sean Geng",
    post_url: "https://x.com/seangeng/status/42",
    created_at: "2026-03-04T05:06:07Z",
    external_urls: ["https://example.com/a"],
  });

  assert.ok(result);
  assert.equal(result.author.handle, "seangeng");
  assert.equal(result.author.name, "Sean Geng");
  assert.equal(result.url, "https://x.com/seangeng/status/42");
  assert.deepEqual(result.external_urls, ["https://example.com/a"]);
});

test("normalizeExport de-duplicates, sorts newest first, and counts junk", () => {
  const make = (id: string, created: string) => ({
    id,
    text: "t",
    author: { name: "n", handle: "h" },
    url: `https://x.com/h/status/${id}`,
    created_at: created,
  });

  const { bookmarks, skipped } = normalizeExport([
    make("1", "2026-01-01T00:00:00.000Z"),
    make("2", "2026-06-01T00:00:00.000Z"),
    make("1", "2026-01-01T00:00:00.000Z"),
    { text: "no id" },
    null,
  ]);

  assert.deepEqual(
    bookmarks.map((bookmark) => bookmark.id),
    ["2", "1"],
  );
  assert.equal(skipped, 2);
});

test("shortener links are kept separately, not as crawlable externals", () => {
  const result = normalizeBookmark({
    id: "7",
    text: "This is crazyyy https://t.co/3pbQ9Le18j and https://bit.ly/abc123",
    author_username: "someone",
    created_at: "2026-01-01T00:00:00Z",
    external_urls: [],
  });

  assert.ok(result);
  assert.deepEqual(result.external_urls, [], "a shortener is not crawlable content");
  assert.deepEqual(result.short_urls.sort(), [
    "https://bit.ly/abc123",
    "https://t.co/3pbQ9Le18j",
  ]);
});

test("an expanded url wins and the shortener is still recorded", () => {
  const result = normalizeBookmark({
    id: "8",
    text: "great tool https://t.co/xyz",
    author_username: "someone",
    created_at: "2026-01-01T00:00:00Z",
    external_urls: ["https://example.com/tool"],
  });

  assert.deepEqual(result?.external_urls, ["https://example.com/tool"]);
  assert.deepEqual(result?.short_urls, ["https://t.co/xyz"]);
});

test("self-referential x.com links are not treated as external", () => {
  const result = normalizeBookmark({
    id: "5",
    text: "quoting https://x.com/someone/status/9 and https://example.com/post",
    author: { name: "n", handle: "h" },
    created_at: "2026-01-01T00:00:00.000Z",
  });

  assert.deepEqual(result?.external_urls, ["https://example.com/post"]);
});

/* ---------------------------------------------------------- seed reading */

/** Seed fixtures go in a temp dir so tests never touch data/bookmarks-seed.json. */
async function seedFixture(contents: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "seed-"));
  const file = path.join(dir, "bookmarks-seed.json");
  await fs.writeFile(file, contents, "utf8");
  return file;
}

test("readSeed rejects placeholder contents from a failed upload", async () => {
  for (const contents of ["<file>", "PLACEHOLDER", "", "null", "TODO"]) {
    const result = await readSeed(await seedFixture(contents));
    assert.equal(result.ok, false, `expected failure for ${JSON.stringify(contents)}`);
    if (result.ok) continue;
    assert.equal(result.reason, "invalid_json");
    assert.match(result.message, /placeholder|valid JSON/i);
  }
});

test("readSeed distinguishes a missing seed from a broken one", async () => {
  const missing = await readSeed(path.join(os.tmpdir(), "definitely-not-here-9182734.json"));
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.reason, "missing");

  const broken = await readSeed(await seedFixture('{"bookmarks": [ this is not json'));
  assert.equal(broken.ok, false);
  if (!broken.ok) assert.equal(broken.reason, "invalid_json");
});

test("readSeed reports a parseable seed that yields nothing usable", async () => {
  const file = await seedFixture(JSON.stringify({ bookmarks: [{ nope: 1 }, { also: 2 }] }));
  const result = await readSeed(file);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "no_bookmarks");
    assert.match(result.message, /2 entries rejected/);
  }
});

test("readSeed catches a truncated export via its own declared count", async () => {
  const file = await seedFixture(
    JSON.stringify({
      count: 196,
      bookmarks: [
        {
          id: "2096692234196283511",
          text: "one of many",
          author_username: "omarsar0",
          post_url: "https://x.com/omarsar0/status/2096692234196283511",
          created_at: "2026-09-06T20:09:17.000Z",
          external_urls: [],
        },
      ],
    }),
  );

  const result = await readSeed(file);
  assert.equal(result.ok, false, "a seed claiming 196 entries but holding 1 must fail");
  if (!result.ok) {
    assert.equal(result.reason, "truncated");
    assert.match(result.message, /declares "count": 196 but contains only 1 entry/);
  }
});

test("a declared count matching the contents passes", async () => {
  const file = await seedFixture(
    JSON.stringify({
      count: 1,
      bookmarks: [
        {
          id: "1",
          text: "complete",
          author_username: "seangeng",
          created_at: "2026-01-01T00:00:00Z",
          external_urls: [],
        },
      ],
    }),
  );

  const result = await readSeed(file);
  assert.equal(result.ok, true, result.ok ? "" : result.message);
  if (result.ok) assert.equal(result.declaredCount, 1);
});

test("readSeed accepts a valid seed and reports skipped entries", async () => {
  const file = await seedFixture(
    JSON.stringify({
      bookmarks: [
        {
          id: "1",
          text: "real",
          author_username: "seangeng",
          post_url: "https://x.com/seangeng/status/1",
          created_at: "2026-01-01T00:00:00Z",
          external_urls: [],
        },
        { garbage: true },
      ],
    }),
  );

  const result = await readSeed(file);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.bookmarks.length, 1);
    assert.equal(result.skipped, 1);
  }
});

test("the committed seed is valid", async () => {
  const result = await readSeed();
  assert.equal(result.ok, true, result.ok ? "" : result.message);
});

/* --------------------------------------------------- seed part assembly */

/**
 * The assembler is a CLI, so these drive it as a subprocess against a fixture
 * tree — that also covers its exit codes, which is what CI depends on.
 */
async function partsFixture(
  parts: { name: string; records: unknown[]; corrupt?: "bytes" | "json" | "count" }[],
  manifestOverrides: Record<string, unknown> = {},
): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "parts-"));
  const dir = path.join(root, "data", "seed-parts");
  await fs.mkdir(dir, { recursive: true });

  const entries = [];
  for (const part of parts) {
    let body = `${JSON.stringify(part.records, null, 2)}\n`;
    const bytes = Buffer.byteLength(body, "utf8");
    const lines = body.split("\n").length - 1;
    const entry = { file: part.name, n: part.records.length, bytes, lines };

    if (part.corrupt === "bytes") body = body.slice(0, Math.floor(body.length / 2));
    if (part.corrupt === "json") body = `${body.slice(0, -3)}`;
    if (part.corrupt === "count") entry.n = part.records.length + 5;

    await fs.writeFile(path.join(dir, part.name), body, "utf8");
    entries.push(entry);
  }

  const declared = parts.reduce((total, part) => total + part.records.length, 0);
  await fs.writeFile(
    path.join(dir, "manifest.json"),
    JSON.stringify({ count: declared, source: "x-bookmarks", parts: entries, ...manifestOverrides }),
    "utf8",
  );
  return root;
}

function makeRecords(from: number, howMany: number): unknown[] {
  return Array.from({ length: howMany }, (_, offset) => ({
    id: String(from + offset),
    text: `record ${from + offset}`,
    author_username: "seangeng",
    post_url: `https://x.com/seangeng/status/${from + offset}`,
    created_at: "2026-09-01T00:00:00.000Z",
    external_urls: [],
  }));
}

function runAssemble(cwd: string, extra: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs"),
      path.join(process.cwd(), "scripts", "assemble-seed.ts"),
      ...extra,
    ],
    {
      cwd,
      encoding: "utf8",
      env: { ...process.env, BOOKMARKS_DATA_DIR: path.join(cwd, "data") },
    },
  );
}

test("assembling every part produces the declared bookmark count", async () => {
  const root = await partsFixture([
    { name: "part-00.json", records: makeRecords(1, 12) },
    { name: "part-01.json", records: makeRecords(13, 12) },
    { name: "part-02.json", records: makeRecords(25, 4) },
  ]);

  const result = runAssemble(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Wrote 28 bookmarks/);

  const seed = JSON.parse(
    await fs.readFile(path.join(root, "data", "bookmarks-seed.json"), "utf8"),
  );
  assert.equal(seed.count, 28);
  assert.equal(seed.bookmarks.length, 28);
  assert.equal(seed.bookmarks[0].id, "1");
  assert.equal(seed.bookmarks.at(-1).id, "28");
});

test("a part short of its manifest byte count is rejected, writing nothing", async () => {
  const root = await partsFixture([
    { name: "part-00.json", records: makeRecords(1, 12) },
    { name: "part-01.json", records: makeRecords(13, 12), corrupt: "bytes" },
  ]);

  const result = runAssemble(root, ["--if-complete"]);
  assert.equal(result.status, 1, "a truncated part must fail even with --if-complete");
  assert.match(result.stdout + result.stderr, /BROKEN\s+part-01\.json[\s\S]*bytes/);

  await assert.rejects(() => fs.readFile(path.join(root, "data", "bookmarks-seed.json"), "utf8"));
});

test("a part whose record count disagrees with the manifest is rejected", async () => {
  const root = await partsFixture([
    { name: "part-00.json", records: makeRecords(1, 12), corrupt: "count" },
  ]);

  const result = runAssemble(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /12 records, manifest says 17/);
});

test("--if-complete is a quiet no-op while parts are still arriving", async () => {
  const root = await partsFixture([{ name: "part-00.json", records: makeRecords(1, 12) }]);

  // Announce a second part in the manifest without writing it, leaving the
  // first part's real numbers intact so it still verifies.
  const manifestFile = path.join(root, "data", "seed-parts", "manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
  manifest.count = 24;
  manifest.parts.push({ file: "part-01.json", n: 12, bytes: 999, lines: 99 });
  await fs.writeFile(manifestFile, JSON.stringify(manifest), "utf8");

  const result = runAssemble(root, ["--if-complete"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Waiting on 1 part\(s\): part-01\.json/);
  await assert.rejects(() => fs.readFile(path.join(root, "data", "bookmarks-seed.json"), "utf8"));
});

test("a manifest last_id absent from the parts is rejected", async () => {
  const root = await partsFixture(
    [{ name: "part-00.json", records: makeRecords(1, 12) }],
    { last_id: "9999999" },
  );

  const result = runAssemble(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout + result.stderr, /last_id 9999999 is not in the assembled set/);
});

/* ------------------------------------------------------------------ urls */

test("normalizeUrl canonicalizes so one page maps to one crawl key", () => {
  assert.equal(
    normalizeUrl("https://WWW.Example.com/a/b/?utm_source=x&id=7#frag"),
    "https://example.com/a/b?id=7",
  );
  assert.equal(normalizeUrl("example.com/x"), "https://example.com/x");
  assert.equal(normalizeUrl("mailto:a@b.com"), null);
  assert.equal(normalizeUrl("   "), null);
});

/* ------------------------------------------------------------ tokenizer */

test("tokenizer keeps compounds whole and split, and drops stop words", () => {
  const tokens = terms("Zero-knowledge proofs are the best");
  assert.ok(tokens.includes("zero-knowledge"), "compound retained");
  assert.ok(tokens.includes("zero") && tokens.includes("knowledge"), "compound split");
  assert.ok(!tokens.includes("are") && !tokens.includes("the"), "stop words removed");
});

test("light stemming folds plurals so index and query agree", () => {
  assert.deepEqual(terms("embeddings"), terms("embedding"));
  assert.deepEqual(terms("budgets"), terms("budget"));
});

test("stripShortenerUrls removes shorteners but keeps real links", () => {
  assert.equal(
    stripShortenerUrls("This is crazyyy https://t.co/3pbQ9Le18j"),
    "This is crazyyy",
  );
  assert.equal(
    stripShortenerUrls("read https://example.com/post and https://bit.ly/x"),
    "read https://example.com/post and",
  );
  assert.equal(stripShortenerUrls("no links here"), "no links here");
});

test("postBody falls back to the summary, then flags link-only posts", () => {
  assert.deepEqual(postBody("This is crazyyy https://t.co/abc", "ignored"), {
    body: "This is crazyyy",
    linkOnly: false,
  });

  // Nothing but a shortener: fall back to what the crawl learned.
  assert.deepEqual(postBody("https://t.co/abc", "Taste-Skill — gives your AI good taste"), {
    body: "Taste-Skill — gives your AI good taste",
    linkOnly: false,
  });

  // Nothing but a shortener and nothing crawled: the card must say so.
  assert.equal(postBody("https://t.co/abc", "").linkOnly, true);
});

test("snippetFor centres on the query terms", () => {
  const source = `${"filler word ".repeat(40)}the error budget is spent ${"tail word ".repeat(40)}`;
  const snippet = snippetFor(source, "error budget", 120);
  assert.ok(snippet.includes("error budget"), snippet);
  assert.ok(snippet.length < 200, "snippet stays bounded");
});

/* --------------------------------------------------------------- topics */

test("topic scoring files content by keywords and link domain", () => {
  const kubernetes = scoreTopics({
    text: "Kubernetes concepts: pods, containers, deployment, scaling",
    urls: ["https://kubernetes.io/docs/concepts/overview/"],
  });
  assert.deepEqual(pickTopics(kubernetes), ["infra"]);

  const paper = scoreTopics({
    text: "transformer attention embeddings benchmark eval",
    urls: ["https://arxiv.org/abs/1706.03762"],
  });
  assert.equal(pickTopics(paper)[0], "ai-ml");
});

test("unclassifiable content falls back to misc", () => {
  assert.deepEqual(pickTopics(scoreTopics({ text: "a nice photo of a dog", urls: [] })), ["misc"]);
});

test("export topic hints are recognised by label, slug, and alias", () => {
  assert.equal(toTopicSlug("AI/ML"), "ai-ml");
  assert.equal(toTopicSlug("machine learning"), "ai-ml");
  assert.equal(toTopicSlug("devtools"), "devtools");
  assert.equal(toTopicSlug("web3"), "crypto");
  assert.equal(toTopicSlug("nonsense"), null);
});

/* --------------------------------------------------------------- robots */

test("robots wildcards do not over-block (the /*/cgi-bin/ case)", () => {
  const robots = parseRobots(
    ["User-agent: *", "Disallow: /cgi-bin/", "Disallow: /*/cgi-bin/", "Disallow: /P/"].join("\n"),
  );

  assert.equal(pathAllowed(robots, "/greatwork.html"), true);
  assert.equal(pathAllowed(robots, "/cgi-bin/x"), false);
  assert.equal(pathAllowed(robots, "/a/cgi-bin/x"), false);
  assert.equal(pathAllowed(robots, "/P/anything"), false);
});

test("robots Allow beats a shorter Disallow, and query patterns are scoped", () => {
  const robots = parseRobots(
    ["User-agent: *", "Disallow: /wp-admin/", "Allow: /wp-admin/admin-ajax.php", "Disallow: /*?"].join(
      "\n",
    ),
  );

  assert.equal(pathAllowed(robots, "/wp-admin/settings"), false);
  assert.equal(pathAllowed(robots, "/wp-admin/admin-ajax.php"), true);
  assert.equal(pathAllowed(robots, "/docs?page=2"), false);
  assert.equal(pathAllowed(robots, "/docs"), true);
});

test("robots rules for other user agents are ignored", () => {
  const robots = parseRobots(
    ["User-agent: Roverbot", "Disallow: /", "", "User-agent: *", "Disallow: /private"].join("\n"),
  );

  assert.equal(pathAllowed(robots, "/anything"), true);
  assert.equal(pathAllowed(robots, "/private/x"), false);
});

test("an empty Disallow value means everything is allowed", () => {
  const robots = parseRobots(["User-agent: *", "Disallow:"].join("\n"));
  assert.equal(pathAllowed(robots, "/anything"), true);
  assert.equal(robots.rules.length, 0);
});

/* ---------------------------------------------------------- extraction */

test("extractArticle pulls metadata and body while dropping page chrome", () => {
  const html = `<!doctype html><html><head>
      <title>Fallback title</title>
      <meta property="og:title" content="Real Title" />
      <meta name="description" content="A short description." />
      <meta property="og:site_name" content="Example" />
      <meta property="article:published_time" content="2026-02-03T10:00:00Z" />
    </head><body>
      <nav>Home About Contact</nav>
      <article>
        <h1>Real Title</h1>
        <p>The first paragraph is long enough to survive the minimum length filter.</p>
        <p>The second paragraph is also long enough to survive the length filter.</p>
      </article>
      <footer>Copyright notice that should not appear in the extraction at all.</footer>
    </body></html>`;

  const result = extractArticle(html, { maxChars: 500 });
  assert.equal(result.title, "Real Title", "og:title wins over <title>");
  assert.equal(result.description, "A short description.");
  assert.equal(result.site_name, "Example");
  assert.equal(result.published_at, "2026-02-03T10:00:00.000Z");
  assert.ok(result.text.includes("first paragraph"));
  assert.ok(result.text.includes("second paragraph"));
  assert.ok(!result.text.includes("Copyright notice"), "footer stripped");
  assert.ok(!result.text.includes("About Contact"), "nav stripped");
  assert.ok(result.word_count > 10);
});

test("extractArticle truncates to maxChars", () => {
  const body = `<p>${"word ".repeat(500)}</p>`;
  const result = extractArticle(`<html><body><article>${body}</article></body></html>`, {
    maxChars: 200,
  });
  assert.ok(result.text.length <= 200, `got ${result.text.length}`);
});

/* --------------------------------------------------------- embeddings */

test("local embeddings are deterministic and unit length", () => {
  const a = localEmbed("vector search over bookmarks");
  const b = localEmbed("vector search over bookmarks");
  assert.deepEqual(a, b);

  const norm = Math.sqrt(a.reduce((sum, value) => sum + value * value, 0));
  assert.ok(Math.abs(norm - 1) < 1e-9, `norm was ${norm}`);
});

test("local embeddings rank related text above unrelated text", () => {
  const query = localEmbed("kubernetes container orchestration");
  const related = localEmbed("Kubernetes concepts: pods, containers and orchestration");
  const unrelated = localEmbed("Nielsen's usability heuristics for interface design");

  assert.ok(
    cosineSimilarity(query, related) > cosineSimilarity(query, unrelated),
    "related text should score higher",
  );
});

test("empty input embeds to a zero vector rather than throwing", () => {
  const vector = localEmbed("");
  assert.equal(vector.length, 512);
  assert.ok(vector.every((value) => value === 0));
});
