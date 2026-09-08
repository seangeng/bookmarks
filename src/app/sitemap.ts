import type { MetadataRoute } from "next";

import { getAllLinks, getTopicSummaries, indexMeta } from "@/lib/library";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://bookmarks.seangeng.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const indexedAt = new Date(indexMeta.generated_at);

  return [
    { url: siteUrl, lastModified: indexedAt, priority: 1 },
    { url: `${siteUrl}/topics`, lastModified: indexedAt, priority: 0.8 },
    ...getTopicSummaries().map((topic) => ({
      url: `${siteUrl}/topics/${topic.slug}`,
      lastModified: indexedAt,
      priority: 0.7,
    })),
    ...getAllLinks().map((link) => ({
      url: `${siteUrl}/s/${link.id}`,
      lastModified: new Date(link.saved_at),
      priority: 0.5,
    })),
  ];
}
