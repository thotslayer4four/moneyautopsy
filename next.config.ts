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
  },
};

export default nextConfig;
