import { createRequire } from "node:module";
import { createMDX } from "fumadocs-mdx/next";
import type { NextConfig } from "next";

const withMDX = createMDX();
const require = createRequire(import.meta.url);
// TGEIST-07: examples/** import `vgpu` and `@vgpu/*` workspace packages
// straight from source (no build step) and `.wgsl` shader files directly.
const wgslLoader = require.resolve("@vgpu/wgsl/loader-webpack");

const config: NextConfig = {
  // TGEIST-07 begin: examples cluster support (transpile + wgsl loader).
  // Keep this region distinct from `outputFileTracingIncludes` below, which
  // is owned by TGEIST-06 (examples API, Grupo A).
  transpilePackages: [
    "vgpu",
    "@vgpu/core",
    "@vgpu/wgsl",
    "@vgpu/wgsl-std",
    "@vgpu/adapter-mock",
    "@vgpu/adapter-node",
  ],

  turbopack: {
    rules: {
      "*.wgsl": {
        loaders: [wgslLoader],
        as: "*.js",
      },
    },
  },
  // TGEIST-07 end.

  experimental: {
    turbopackFileSystemCacheForDev: true,
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
