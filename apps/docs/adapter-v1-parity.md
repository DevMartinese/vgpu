# Adapter v1 all-ten parity validation

Date: 2026-07-24

This is evidence only. It does not activate adapter v1, replace checked-in adapter-v0 artifacts, or open the production publish gate.

## Inputs

- React worktree (read-only): `/home/user/vgpu-worktrees/react-examples`
- Branch: `refactor/react-examples`
- Commit: `55c702404d8b5da0f73214f5e5f42596f3d3ee39`
- `apps/docs/lib/examples-source.generated.ts` SHA-256: `ff64440529d3839ab8fd9eeee9250859102eaf94ecc2ac0124d7423983f5ed7c`
- Adapter/generator: this branch at `d6db7334b93f99215e50e5f44d8ff8009213c2d6`
- Source identity used in the candidate byte graph: repository `https://github.com/vgpu/vgpu`, git commit `55c702404d8b5da0f73214f5e5f42596f3d3ee39`

The generated module was copied to `/tmp/adapter-v1-parity/react-source.ts`; only its runtime-only `server-only` import and TypeScript-only type import/satisfies clause were removed so a scratch Node bundle could import the unchanged `exampleSources` data. Nothing in the React worktree or checked-in generated API tree was modified.

## Candidate identity

- Adapter-v1 revision: `05ce8f69c116fd6674c10dd2579493690a957a01232ab14e15839eaa208a7fcf`
- Candidate artifacts: 114
- Canonical source files: 100
- Sorted artifact identity digest: `87892b26ecdc13625aa631b504e2ae86b965cb17c969539f9ef241b417173b33`
- Scratch trees: `/tmp/adapter-v1-parity/tree-a` and `/tmp/adapter-v1-parity/tree-b`
- Machine-readable scratch evidence: `/tmp/adapter-v1-parity/evidence.json`

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| React ref and source hash | PASS | Full commit and generated-source SHA-256 exactly match the announced checkpoint. |
| All ten slugs | PASS | `gradient`, `triangle-led-front`, `anti-aliasing`, `post-processing`, `black-hole`, `fluid`, `instanced-rendering`, `batch-rendering`, `fft-ocean`, `raymarched-fractal`. |
| API/CodeViewer byte parity | PASS | All 100 generated source strings were independently SHA-256 hashed and matched both adapter-v1 graph files and emitted `.raw` artifact bytes. |
| Artifact integrity | PASS | All 114 artifact byte hashes recomputed; `revision.json` ordered keys, sizes, content types, and SHA-256 values matched every retained object. |
| Frozen JSON schemas | PASS | Ajv 2020 validated discovery, latest, index, and all ten manifests (13 schema-covered JSON documents). The schema-less revision document and 100 raw objects were checked through retained-object and manifest byte/hash contracts. |
| Fractal tags | PASS | Exact ordered value: `raymarching`, `raymarch`, `fractal`, `sierpinski`, `hdr`, `bloom`. |
| Canonical order | PASS | Adapter output exactly preserved every generated `files` array; all start with `index.tsx`, place optional controls/types before `renderer.ts`, place helpers after it, and keep WGSL as the final pipeline suffix. |
| Determinism x2 | PASS | Both runs produced revision `05ce8f69c116fd6674c10dd2579493690a957a01232ab14e15839eaa208a7fcf` and artifact digest `87892b26ecdc13625aa631b504e2ae86b965cb17c969539f9ef241b417173b33`. |
| Controlled vocabulary | **FAIL** | Authored metadata contains controlled terms absent from the checked-in foundation vocabularies; there were no duplicate authored values. |

Unknown tags:

```text
shader, triangle, led, raycasting, lighting, msaa, ssaa, fxaa,
chromatic-aberration, color-grading, black-hole, simulation, navier-stokes,
indirect-rendering, performance, batch-rendering, render-bundles
```

Unknown capabilities:

```text
webgpu, fragment-shader, continuous-rendering, responsive-canvas,
select-control, pointer-input, render-targets, checkbox-controls,
pointer-orbit, compute-shader, fixed-timestep, instanced-rendering,
offscreen-rendering, resize, demand-rendering
```

Because controlled vocabulary validation fails, the all-ten adapter-v1 parity gate is **not yet green**. The checked-in generated artifacts remain on adapter v0 and production publishing remains blocked. Vocabulary reconciliation requires an explicit author decision: either normalize React metadata to the existing controlled terms or approve additions to the controlled vocabulary and its validation coverage.

## Exact generated file order

```text
gradient: index.tsx, renderer.ts, shader.wgsl
triangle-led-front: index.tsx, controls.tsx, types.ts, renderer.ts, scene-renderer.ts, light-sources-raw.ts, light-sources-pass.ts, led-buffer.ts, settings.ts, hero-frame-state.ts, direct-triangle-raycast.ts, value-noise.ts, triangle-hit.ts, sim-sizing.ts, shaders/light-sources.wgsl, shaders/led-emitters.wgsl, shaders/direct-triangle-raycast.wgsl, shaders/floor-noise.wgsl, shaders/color-utils.wgsl, shaders/geometry.wgsl, shaders/floor-falloff.wgsl, shaders/hash.wgsl, shaders/themes/dark/main-scene-floor.wgsl, shaders/themes/light/main-scene-floor.wgsl
anti-aliasing: index.tsx, controls.tsx, types.ts, renderer.ts, scene.wgsl, resolve.wgsl, fxaa.wgsl
post-processing: index.tsx, controls.tsx, types.ts, renderer.ts, scene.wgsl, threshold.wgsl, blur.wgsl, grade.wgsl
black-hole: index.tsx, renderer.ts, black-hole.wgsl, bright-pass.wgsl, blur.wgsl, composite.wgsl
fluid: index.tsx, renderer.ts, pointer-input.ts, simulation.ts, validation.ts, math.ts, fluid-common.wgsl, advect-velocity.wgsl, curl.wgsl, vorticity.wgsl, divergence.wgsl, pressure.wgsl, project.wgsl, advect-dye.wgsl, display.wgsl
instanced-rendering: index.tsx, controls.tsx, types.ts, renderer.ts, scene.wgsl, blit.wgsl
batch-rendering: index.tsx, renderer.ts, scene.wgsl, blit.wgsl
fft-ocean: index.tsx, renderer.ts, ocean-graph.ts, tuning.ts, camera.ts, ocean-common.wgsl, noise.wgsl, initial-spectrum.wgsl, spectrum.wgsl, ifft-stage.wgsl, normal-foam.wgsl, particles.wgsl, particles-common.wgsl, particles-light.wgsl, bloom-bright.wgsl, bloom-blur.wgsl, bloom-composite.wgsl, present.wgsl, stage-preview.wgsl
raymarched-fractal: index.tsx, renderer.ts, pointer-input.ts, fractal-math.ts, fractal.wgsl, bright-pass.wgsl, blur.wgsl, composite.wgsl
```

## Later integration flip

After the React branch merges to main, controlled vocabulary reconciliation passes, and the author approves launch:

1. Switch the generation script from `createLegacyByteGraph`/adapter v0 to `adaptCanonicalSourceExport(exampleSources, source)`/adapter v1.
2. Regenerate and review the checked-in artifact tree; rerun all byte, schema, vocabulary, determinism, route, CLI E2E, and production-build gates.
3. Change the script's `publicAdapter` launch guard from `v0` to `v1` (or remove the now-satisfied adapter-v0 block) in the same reviewed integration commit.
4. Perform the author-approved publish: create/verify immutable objects, verify deployed routes, advance discovery, and advance/verify latest last.
