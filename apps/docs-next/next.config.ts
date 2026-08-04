import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();

const config: NextConfig = {
  experimental: {
    turbopackFileSystemCacheForDev: true,
  },

  // ANCHOR TGEIST-06 (examples API transplant) -- this key is owned by that ticket alone; copied
  // literally, globs included, from the old app's next.config.mjs.
  // The examples API serves the generated tree straight from the deployment, reading it with fs at
  // request time. Static tracing cannot see a path built at runtime, so these routes must be told
  // to bundle the tree explicitly or every artifact 404s in production.
  // Keys are picomatch globs, not literal route paths, so a dynamic segment cannot be written
  // out: `[revision]` and `[...artifact]` would parse as character classes and match nothing.
  // `check:examples-api-tracing` fails the build if any of the three routes loses the tree.
  outputFileTracingIncludes: {
    "/.well-known/vgpu-examples.json": ["./generated/examples-api/**/*"],
    "/api/examples/v1/latest.json": ["./generated/examples-api/**/*"],
    "/api/examples/v1/revisions/**": ["./generated/examples-api/**/*"],
  },

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "placehold.co",
      },
    ],
  },
};

export default withMDX(config);
