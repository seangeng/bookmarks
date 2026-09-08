import assert from "node:assert/strict";
import { test } from "node:test";

import { parseRobots, pathAllowed } from "../scripts/lib/crawler";
import { extractArticle } from "../scripts/lib/extract";
import { cosineSimilarity, localEmbed } from "../src/lib/embeddings";
import { normalizeBookmark, normalizeExport } from "../src/lib/normalize";
import { normalizeUrl, snippetFor, terms } from "../src/lib/text";
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

test("self-referential x.com links are not treated as external", () => {
  const result = normalizeBookmark({
    id: "5",
    text: "quoting https://x.com/someone/status/9 and https://example.com/post",
    author: { name: "n", handle: "h" },
    created_at: "2026-01-01T00:00:00.000Z",
  });

  assert.deepEqual(result?.external_urls, ["https://example.com/post"]);
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
