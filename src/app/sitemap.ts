import type { MetadataRoute } from "next";

import { getAllBookmarks, getTopicSummaries, indexMeta } from "@/lib/library";

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
    ...getAllBookmarks().map((bookmark) => ({
      url: `${siteUrl}/b/${bookmark.id}`,
      lastModified: new Date(bookmark.created_at),
      priority: 0.5,
    })),
  ];
}
