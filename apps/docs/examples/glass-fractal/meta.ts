import type { ExampleMetaDefinition } from "../../lib/example-meta";

export const meta = {
  slug: "glass-fractal",
  title: "Glass Fractal",
  description:
    "A beveled glass tetrahedron contains a morphing fractal mesh and liquid orb, combining screen-space transmission, studio reflections, soft material lighting and interactive controls.",
  tags: ["fractal", "frosted-glass", "lighting", "hdr", "shader"],
  capabilities: [
    "webgpu",
    "controls",
    "pointer-input",
    "multi-pass",
    "render-targets",
    "continuous-rendering",
    "responsive-canvas",
    "textures",
    "hdr",
  ],
  thumb: {
    headless: false,
    note: "Browser capture: the example loads authored meshes and a packed cubemap.",
  },
  files: [
    "index.tsx",
    "renderer.ts",
    "hero-glass-assets.ts",
    "hero-debug-axes.wgsl",
    "hero-fractal-background-draw.wgsl",
    "hero-fractal-ceramic.wgsl",
    "hero-fractal-face-instance.wgsl",
    "hero-fractal-floor-ao.wgsl",
    "hero-fractal-light.wgsl",
    "hero-fractal-mesh.wgsl",
    "hero-fractal-present.wgsl",
    "hero-fractal-sdf.wgsl",
    "hero-fractal-wireframe.wgsl",
    "hero-glass-environment-debug.wgsl",
    "hero-glass-environment.wgsl",
    "hero-glass-transmission.wgsl",
    "hero-glass-wireframe.wgsl",
    "hero-glass.wgsl",
  ],
} as const satisfies ExampleMetaDefinition;
