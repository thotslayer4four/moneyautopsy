import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/brand";

// Only the API is off limits. The private flow pages (upload, report…) are kept out of search
// with a noindex tag instead, which crawlers can only honour if they're allowed to read it.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
