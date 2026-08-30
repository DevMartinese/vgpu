# three-tsl

Imports a WGSL module through the `@vgpu/wgsl` Vite loader and connects its
functions to a three.js `MeshPhysicalNodeMaterial` as TSL nodes.

```
src/marble.wgsl        WGSL module; imports hash3 from @vgpu/wgsl-std/hash
src/wgsl-tsl.ts        tslExports(): loader output -> callable wgslFn TSL nodes
src/marble-material.ts physical material with colorNode/roughnessNode from WGSL
src/main.ts            torus knot scene, WebGPURenderer
src/harness.ts         offscreen render smoke check (also runs headless)
```

## Run

```bash
pnpm install
pnpm --filter @vgpu/example-three-tsl dev
```

Open the printed URL in a WebGPU-capable browser.

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
