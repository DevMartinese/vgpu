# @vgpu/wgsl

## 0.2.0

### Minor Changes

- 3731a3c: WGSL package imports now resolve third-party and workspace packages in every install layout. A package that exports `.wgsl` files through its `exports` map (the same shape `@vgpu/wgsl-std` uses) already worked when installed as a direct dependency under npm and pnpm, including a `workspace:*` package linked into an app in a monorepo, but two layouts failed with `VGPU-WGSL-PKG-NOTFOUND`:

  - **A WGSL package that imports another WGSL package under pnpm.** The importing module lives in `node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`, reached through a symlink, and its own dependencies are installed next to that store entry — never next to the symlink, so the `node_modules` walk could not see them. The walk now also runs from the importing file's real path, which is how Node itself resolves.
  - **Yarn PnP.** PnP keeps packages inside zip archives with no `node_modules` directories to walk. When the PnP runtime is active in the process (any `yarn`-launched build), the resolver now asks Node to resolve the specifier _from the importing shader_, which hits Yarn's resolver and returns a zip-internal path that PnP's patched `fs` can read.

  Resolution precedence is unchanged: the importing project's own `node_modules` still wins, the walk still stops at the workspace root, and the `@vgpu/*`-scoped fallback that rescues `@vgpu/wgsl-std` from an isolated layout still runs last. The new PnP step resolves from the _user's_ file, so it can only reach what the shader's own package declares.

- eba8e4d: `VGPU-WGSL-PKG-NOTFOUND` now prescribes the fix instead of only naming the miss: an uninstalled package reports `Package <pkg> was not found. Install the package (npm install <pkg>) or check the specifier`, in-memory resolution points at `packageMap`/`modules`, and an unknown subpath names the package and its `exports` map. Scoped packages are also reported correctly — the filesystem message said `Package @vgpu` for `@vgpu/wgsl-std/noise` before.

  WGSL package imports also resolve in layouts where the package reaches the project transitively. Resolution now tries the importing project's `node_modules` first (an installed copy always wins) and then Node's own resolver next to `@vgpu/wgsl`, which depends on `@vgpu/wgsl-std`. Walking up from the shader alone only worked when the package manager hoisted the package, so `import ... from "@vgpu/wgsl-std/noise"` failed under pnpm's isolated `node_modules` and Yarn PnP even though the package was installed.

- 47f7ec8: Add `constants` to `DrawOptions` (`draw(gpu)`) and `ComputeOptions` (`compute(gpu)`): constructor-only values for WGSL `override` pipeline constants, flowing into `GPUProgrammableStage.constants` — both the vertex and fragment stages for draws (WebGPU matches keys against the module's override declarations, not per entry point, so one record serves both stages) and the compute stage for compute pipelines. Key by override name, or by the decimal string of `N` when the declaration has `@id(N)` (the name is not usable then, mirroring WebGPU's identifier rule). Values are finite numbers or booleans; booleans convert to `1`/`0` doubles that WebGPU converts to the override's WGSL type (bool/i32/u32/f32/f16). Draws that differ only in `constants` compile distinct pipelines; an absent option — or an empty `{}` — keeps byte-identical descriptors and pipeline cache keys. `VGPU-CONSTANTS-INVALID` throws at construction for a non-object `constants`, a key that matches no override in the shader (the message lists the available overrides), a value that is neither a finite number nor a boolean, or an override declared without a default that `constants` does not provide.

  `@vgpu/wgsl` reflection: `OverrideInfo` gains an optional `id` field carrying the `@id(N)` pipeline constant ID; `defaultValue` continues to mark declarations with a default initializer. The change is additive — existing `Reflection` consumers are unaffected.

### Patch Changes

- 2856407: The transitive-resolution fallback in `resolveImport` is now scoped to `@vgpu/*` specifiers. That fallback (`resolveAlongsideResolver`) exists only to rescue `@vgpu/wgsl`'s own transitive dependencies (like `@vgpu/wgsl-std`) in isolated pnpm/PnP layouts, but it previously ran for any bare specifier that failed the project-local `node_modules` walk. That meant a mistyped or unrelated WGSL import (e.g. `webpack`, a devDependency of `@vgpu/wgsl` itself) could resolve to the real installed JS file and fail later with a confusing `VGPU-WGSL-REFLECT-PARSE Expected identifier`, instead of the clear `VGPU-WGSL-PKG-NOTFOUND` (with its install fix-it) that non-`@vgpu` specifiers should get.
- Updated dependencies [8345a03]
- Updated dependencies [65cc995]
  - @vgpu/wgsl-std@0.2.0

- f526de2: Resolve bare package specifiers in WGSL _nominal type_ positions. A struct imported from a package subpath — `import { VoronoiSample2 } from "@vgpu/wgsl-std/noise"` — can now type a binding, a struct member, a type alias or a function signature; previously only relative and root-alias imports resolved there, so reflection silently failed to find the struct and the binding came back without its `struct`/`layout` (member names, offsets and sizes). The value/function positions handled by the mangler were already correct, which is why the gap only showed up in reflected layouts.

  `buildModuleSymbols()` now takes the same import resolver that loaded the module graph, so nominal types go through the identical resolution the loader used (relative, root alias, `packageMap`, `package.json` `exports`). `resolveShader()` passes its resolver through; when no resolver is available, or resolution throws, the previous relative/absolute heuristic still applies, so nothing that resolved before stops resolving.

- 8fc4daf: Report WGSL reserved words and keywords used as declared identifiers on every build-time path. Struct names, struct members, type aliases, module-scope variables, overrides, functions, parameters and local variables whose name is reserved by the WGSL spec (e.g. `struct Paint { from: vec2f }`) now produce a `VGPU-WGSL-RESERVED-IDENT` error diagnostic with the offending name, file, line and column. Previously these passed with zero diagnostics and only failed later inside Dawn at pipeline creation.

  - `resolveShader()` collects the diagnostics per loaded module, so imported modules report their own location.
  - The Vite plugin and the webpack loader fail the build on error-severity diagnostics — in both the leaf-shader path and the import-graph path — with a message listing `file:line:column`. Warnings such as `VGPU-WGSL-PKG-CONDITIONAL` stay non-fatal.
  - `vgpu check` serializes diagnostics correctly (their `message` was being dropped by `JSON.stringify` because `Error.message` is not enumerable) and exits with code `1` when any error-severity diagnostic is reported.

  `compile()` keeps its byte-for-byte passthrough behavior: running the pass there would pull the scanner into the browser-facing `@vgpu/wgsl` entry (688 B → 4062 B gzip against a 1024 B budget), and runtime WGSL strings are reported by the driver at `createShaderModule`.

  The reserved-word and keyword lists are now verbatim from the WGSL spec: this adds `non_coherent`, `noncoherent` and `type`, and moves `binding_array` (dropped from the current spec list) into a separate legacy set that still blocks identifier minification from generating it.
