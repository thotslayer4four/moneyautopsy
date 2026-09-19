import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist dynamically loads its own worker script by a path relative to itself at
  // runtime. Left bundled, Turbopack/webpack rewrites that into a chunk path the worker
  // file was never emitted at ("Setting up fake worker failed: Cannot find module ...").
  // Excluding it from bundling lets it load straight from node_modules instead.
  serverExternalPackages: ["pdfjs-dist"],
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
