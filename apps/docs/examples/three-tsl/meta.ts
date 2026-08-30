export const meta = {
  slug: "three-tsl",
  title: "WGSL in three.js",
  description:
    "Author a procedural lava material as plain WGSL modules and wire them into a three.js node material — twelve surface slots, all driven from shader source.",
  tags: ["3d", "shader", "lighting", "hdr", "bloom", "post-processing"],
  capabilities: [
    "webgpu",
    "pointer-orbit",
    "select-control",
    "continuous-rendering",
    "responsive-canvas",
    "multi-pass",
    "hdr",
    "textures",
  ],
  thumb: { warmupFrames: 3, dt: 1 / 60, time: 2.1 },
  files: [
    "index.tsx",
    "renderer.ts",
    "scenes.ts",
    "lava-material.ts",
    "wgsl-tsl.ts",
    "environment.ts",
    "post.ts",
    "lava.wgsl",
    "noise.wgsl",
  ],
} as const;
