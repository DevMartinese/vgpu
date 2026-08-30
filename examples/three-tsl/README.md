# three-tsl

Imports WGSL modules through the `@vgpu/wgsl` Vite loader and connects their
functions to three.js `MeshPhysicalNodeMaterial`s as TSL nodes.

```
src/noise.wgsl         shared value noise / fbm / ridged noise module
src/lava.wgsl          heat, crust, sink, and blackbody fields; uses
                       @vgpu/wgsl-std voronoi3d + noise.wgsl
src/marble.wgsl        marble veins; imports fbm3 from noise.wgsl
src/wgsl-tsl.ts        tslExports(): loader output -> callable wgslFn TSL nodes
src/lava-material.ts   physical material: emissive cracks, bump normals, and
                       vertex relief all driven by lava.wgsl
src/marble-material.ts physical material with colorNode/roughnessNode from WGSL
src/main.ts            torus knot scene, WebGPURenderer (?material=marble)
src/harness.ts         offscreen render smoke check (also runs headless)
```

## Run

```bash
pnpm install
pnpm --filter @vgpu/example-three-tsl dev
```

Open the printed URL in a WebGPU-capable browser. The default scene is the
lava material; append `?material=marble` for the marble demo.

## The lava material

Everything procedural lives in `lava.wgsl` and flows into the material as
TSL nodes:

- `lavaHeat` — voronoi plate boundaries (`f2 - f1` from
  `@vgpu/wgsl-std/noise`) warped by fbm become variable-width incandescent
  cracks, with an ember halo, hairline secondary cracks gated by an
  "activity" field, and occasional streaked melt windows.
- `blackbody` — incandescence ramp (black → deep red → orange → yellow-white)
  feeding `emissiveNode` with HDR intensity under ACES tone mapping.
- `crustHeight` — plate relief plus pahoehoe rope folds on lobe patches,
  clinkery rubble elsewhere, and clustered vesicle pits; sampled once for
  shading and three more times by finite differences in TSL to build
  `normalNode` bump detail.
- `crustSurface` — one `vec4f` of shading masks (tone mottling, oxide
  staining, glassy-skin mask, vesicle pits) driving albedo, roughness
  variation, and a clearcoat "volcanic glass" sheen.
- `lavaSink` — a wide low-frequency channel mask for `positionNode` vertex
  displacement, kept separate from the thin cracks so coarse meshes don't
  stipple.

Lighting is image-based: a CC0 Poly Haven night HDRI (via `@pmndrs/assets`)
drives `scene.environment` and the backdrop, plus a cool moonlight key and a
faint warm floor bounce standing in for the glow lighting the crust back.

## How the bridge works

- `import marbleModule from "./marble.wgsl"` returns `{ version: 1, wgsl }`:
  the flattened module graph, with imported helpers mangled to
  `_vgsl_<hash>__<name>` and no `export` keywords left.
- `tslExports(marbleModule, ["marble", "fbm3"])` finds each function by its
  authored name (accepting the mangle prefix), reads its parameter list and
  return type from the header, and emits a forwarding wrapper via TSL's
  `wgslFn`, attaching the whole module once as a shared `wgsl()` include.
- The returned nodes are callable with inputs keyed by WGSL parameter names.
  TSL uniforms flow in as plain function parameters — three owns the actual
  `@group/@binding` layout when it builds the shader:

```ts
const { marble } = tslExports(marbleModule, ["marble"]);
const warp = uniform(6.0);
material.colorNode = mix(baseColor, veinColor, marble({ position: positionLocal, warp }));
```

Entry points and functions that touch `@group/@binding` resources do not map
to `wgslFn` — TSL manages bindings itself. Pure functions (like everything in
`@vgpu/wgsl-std`) are the sweet spot.

## Tests

`pnpm --filter @vgpu/example-three-tsl test` covers the header parser and
wrapper generation, and resolves `src/marble.wgsl` through
`@vgpu/wgsl/runtime` to check the bridge against real loader output.

`/harness.html` (dev server) renders the material into a `RenderTarget` with a
stubbed canvas context and reports lit/distinct pixel counts on
`window.__result` — usable from headless chromium where WebGPU canvas
presentation is unavailable (`--enable-unsafe-webgpu --enable-features=Vulkan
--use-vulkan=swiftshader --in-process-gpu`).
