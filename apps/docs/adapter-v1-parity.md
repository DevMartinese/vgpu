# Adapter v1 all-ten parity validation

Date: 2026-07-24

This is evidence only. It does not activate adapter v1, replace checked-in adapter-v0 artifacts, or open the production publish gate.

## Inputs

- React worktree (read-only): `/home/user/vgpu-worktrees/react-examples`
- Branch: `refactor/react-examples`
- Initial validated checkpoint: `55c702404d8b5da0f73214f5e5f42596f3d3ee39`; generated-source SHA-256 `ff64440529d3839ab8fd9eeee9250859102eaf94ecc2ac0124d7423983f5ed7c`.
- Refreshed validated checkpoint: `8dd1e30beb47a26566cff67f807d3240c6be9c69`; generated-source SHA-256 `8d17c1fc14b7c568a1b97723b56ebc7df0c64e4dc277e433d0569cb0f2c91c72`.
- Adapter/generator: this branch, with adapter implementation inherited from `d6db7334b93f99215e50e5f44d8ff8009213c2d6` and controlled vocabulary from `47cfd77`.
- Current source identity used in the candidate byte graph: repository `https://github.com/vgpu/vgpu`, git commit `8dd1e30beb47a26566cff67f807d3240c6be9c69`.

The generated module was copied to `/tmp/adapter-v1-parity/react-source.ts`; only its runtime-only `server-only` import and TypeScript-only type import/satisfies clause were removed so a scratch Node bundle could import the unchanged `exampleSources` data. Nothing in the React worktree or checked-in generated API tree was modified.

## Validated checkpoint history

| React checkpoint | Generated-source SHA-256 | Candidate revision | Artifact identity digest |
| --- | --- | --- | --- |
| `55c702404d8b5da0f73214f5e5f42596f3d3ee39` | `ff64440529d3839ab8fd9eeee9250859102eaf94ecc2ac0124d7423983f5ed7c` | `05ce8f69c116fd6674c10dd2579493690a957a01232ab14e15839eaa208a7fcf` | `87892b26ecdc13625aa631b504e2ae86b965cb17c969539f9ef241b417173b33` |
| `8dd1e30beb47a26566cff67f807d3240c6be9c69` | `8d17c1fc14b7c568a1b97723b56ebc7df0c64e4dc277e433d0569cb0f2c91c72` | `209e19af4429e971e5d7f163b6b866867fa99ace0799948905e49239b60165b4` | `90aa2c3b6d69ac8115c919552e42a40f7207b30f5cd0c45c62a6a24f403fa5fc` |

## Current candidate identity

- Adapter-v1 revision: `209e19af4429e971e5d7f163b6b866867fa99ace0799948905e49239b60165b4`
- Candidate artifacts: 114
- Canonical source files: 100
- Sorted artifact identity digest: `90aa2c3b6d69ac8115c919552e42a40f7207b30f5cd0c45c62a6a24f403fa5fc`
- Scratch trees: `/tmp/adapter-v1-parity/tree-a` and `/tmp/adapter-v1-parity/tree-b`
- Machine-readable scratch evidence: `/tmp/adapter-v1-parity/evidence.json` (SHA-256 `0c597a0e8ef885735e7fa1c85ff42820728bf0ae34179a09447606cd8482c522`)

## Results

| Check | Result | Evidence |
| --- | --- | --- |
| React ref and source hash | PASS | Both announced checkpoints were validated read-only; the current full commit and generated-source SHA-256 exactly match `8dd1e30` and `8d17c1fc…`. |
| All ten slugs | PASS | `gradient`, `triangle-led-front`, `anti-aliasing`, `post-processing`, `black-hole`, `fluid`, `instanced-rendering`, `batch-rendering`, `fft-ocean`, `raymarched-fractal`. |
| API/CodeViewer byte parity | PASS | All 100 generated source strings were independently SHA-256 hashed and matched both adapter-v1 graph files and emitted `.raw` artifact bytes. |
| Artifact integrity | PASS | All 114 artifact byte hashes recomputed; `revision.json` ordered keys, sizes, content types, and SHA-256 values matched every retained object. |
| Frozen JSON schemas | PASS | Ajv 2020 validated discovery, latest, index, and all ten manifests (13 schema-covered JSON documents). The schema-less revision document and 100 raw objects were checked through retained-object and manifest byte/hash contracts. |
| Fractal tags | PASS | Exact ordered value: `raymarching`, `raymarch`, `fractal`, `sierpinski`, `hdr`, `bloom`. |
| Canonical order | PASS | Adapter output exactly preserved every generated `files` array; all start with `index.tsx`, place optional controls/types before `renderer.ts`, place helpers after it, and keep WGSL as the final pipeline suffix. |
| Determinism x2 | PASS | Both refreshed runs produced revision `209e19af4429e971e5d7f163b6b866867fa99ace0799948905e49239b60165b4` and artifact digest `90aa2c3b6d69ac8115c919552e42a40f7207b30f5cd0c45c62a6a24f403fa5fc`. |
| Controlled vocabulary | PASS | All authored values are present in the additive, checked-in vocabularies; no unknown or duplicate values remain. |

### AUTHOR REVIEW: vocabulary expansion

All proposed values were vetted as lowercase kebab-case, stable technical/topic terms rather than free text, and deliberate authored metadata. The close lexical neighbors remain distinct controlled concepts: `batching` is the general technique while `batch-rendering` identifies the rendering strategy; `compute` is the workload while `compute-shader` names the shader-stage capability; `instancing` is the general mechanism while `instanced-rendering` identifies the authored rendering capability. Cross-category reuse such as `render-bundles` is intentional because tags describe discoverability and capabilities describe runtime requirements. There is no vocabulary-driven search-alias table in the owned docs lane to update.

Accepted tags (17):

```text
batch-rendering, black-hole, chromatic-aberration, color-grading, fxaa,
indirect-rendering, led, lighting, msaa, navier-stokes, performance,
raycasting, render-bundles, shader, simulation, ssaa, triangle
```

Accepted capabilities (15):

```text
checkbox-controls, compute-shader, continuous-rendering, demand-rendering,
fixed-timestep, fragment-shader, instanced-rendering, offscreen-rendering,
pointer-input, pointer-orbit, render-targets, resize, responsive-canvas,
select-control, webgpu
```

Rejected terms: **none**. This additive expansion is explicitly author-reviewable before integration. With it, the all-ten adapter-v1 parity matrix is green. Checked-in generated artifacts nevertheless remain on adapter v0 and production publishing remains blocked until merge and author approval.

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
