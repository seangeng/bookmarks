import { TOPICS } from "../../src/lib/topics";

/**
 * Optional LLM topic classification. Only runs when OPENAI_API_KEY is set;
 * `scripts/build-index.ts` falls back to the deterministic keyword scorer
 * otherwise (and if any request fails).
 */

const TAXONOMY = TOPICS.map((topic) => `- ${topic.slug}: ${topic.blurb}`).join("\n");

const SYSTEM_PROMPT = `You tag saved X (Twitter) bookmarks for a personal research library.

Available topics:
${TAXONOMY}

Rules:
- Return 1-2 topics per bookmark, ordered most relevant first.
- Only use the slugs listed above.
- Use "misc" only when nothing else genuinely fits.
- Judge by what the reader would file it under, not by incidental word matches.

Respond with JSON: {"results":[{"id":"<id>","topics":["<slug>"]}]}`;

export type ClassifyInput = { id: string; text: string };

export async function classifyWithLlm(
  inputs: ClassifyInput[],
  { batchSize = 12 }: { batchSize?: number } = {},
): Promise<(string[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return inputs.map(() => null);

  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o-mini";
  const byId = new Map<string, string[]>();

  for (let i = 0; i < inputs.length; i += batchSize) {
    const batch = inputs.slice(i, i + batchSize);
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: JSON.stringify({
              bookmarks: batch.map((item) => ({ id: item.id, content: item.text })),
            }),
          },
        ],
      }),
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      throw new Error(
        `Classification failed (${response.status}): ${(await response.text()).slice(0, 200)}`,
      );
    }

    const payload = (await response.json()) as {
      choices: { message: { content: string } }[];
    };
    const parsed = JSON.parse(payload.choices[0]?.message?.content ?? "{}") as {
      results?: { id?: string; topics?: string[] }[];
    };

    for (const result of parsed.results ?? []) {
      if (result.id && Array.isArray(result.topics)) {
        byId.set(String(result.id), result.topics.filter((topic) => typeof topic === "string"));
      }
    }
    console.log(`  classified ${Math.min(i + batch.length, inputs.length)}/${inputs.length}`);
  }

  return inputs.map((input) => byId.get(input.id) ?? null);
}
