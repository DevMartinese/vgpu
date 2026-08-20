import type { ExampleMetaDefinition } from "../../lib/example-meta";

export const meta = {
  slug: "optimized-black-hole",
  title: "Optimized Black Hole",
  description:
    "A multi-pass black hole that bakes relativistic ray traversal once into a G-buffer, then reuses it for animated disk shading, stars, antialiasing and HDR bloom.",
  tags: ["black-hole", "raymarching", "performance", "hdr", "bloom", "shader"],
  capabilities: [
    "webgpu",
    "pointer-orbit",
    "multi-pass",
    "render-targets",
    "offscreen-rendering",
    "continuous-rendering",
    "responsive-canvas",
    "textures",
    "hdr",
  ],
  thumb: {
    headless: false,
    note: "Browser capture: the optimized renderer uses its production multi-pass pipeline.",
  },
  files: [
    "index.tsx",
    "renderer.ts",
    "noise-volume.mjs",
    "bake.wgsl",
    "refine.wgsl",
    "gbuffer.wgsl",
    "geodesic.wgsl",
    "shade.wgsl",
    "disk.wgsl",
    "stars.wgsl",
    "bloom.wgsl",
    "composite.wgsl",
  ],
} as const satisfies ExampleMetaDefinition;
