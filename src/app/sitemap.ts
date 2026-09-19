import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

// One public page. The rest of the app is a private, per-person flow and isn't for search.
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: SITE_URL, lastModified: new Date(), changeFrequency: "monthly", priority: 1 }];
}
