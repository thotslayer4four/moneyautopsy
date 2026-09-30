import type { NextConfig } from "next";
import { SITE_URL, VERCEL_PRODUCTION_HOST } from "./src/lib/brand";

const nextConfig: NextConfig = {
  // pdfjs-dist dynamically loads its own worker script by a path relative to itself at
  // runtime. Left bundled, Turbopack/webpack rewrites that into a chunk path the worker
  // file was never emitted at ("Setting up fake worker failed: Cannot find module ...").
  // Excluding it from bundling lets it load straight from node_modules instead.
  serverExternalPackages: ["pdfjs-dist"],
  // Pages on the vercel.app address go to the real domain (query string kept, so a Paystack
  // return with ?reference= still lands on the right report). API routes are left alone: a
  // payment webhook configured against the old address must keep working, not get a redirect.
  async redirects() {
    return [
      {
        source: "/:path((?!api/).*)",
        has: [{ type: "host", value: VERCEL_PRODUCTION_HOST }],
        destination: `${SITE_URL}/:path`,
        permanent: true,
      },
    ];
  },
  // The PDF export reads its fonts from disk at request time, so make sure they ship with the
  // route instead of being dropped as "unused" files.
  outputFileTracingIncludes: {
    "/api/report/[id]/pdf": ["./src/assets/fonts/**/*"],
    // pdfjs-dist starts its worker with a runtime import by path, which the build's file
    // tracing can't see — so on Vercel the worker file was left out of the function and
    // every PDF upload failed with "Cannot find module .../pdf.worker.mjs".
    "/api/analyze": ["./node_modules/pdfjs-dist/legacy/build/**/*", "./node_modules/pdfjs-dist/standard_fonts/**/*"],
  },
};

export default nextConfig;
