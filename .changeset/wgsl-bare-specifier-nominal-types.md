---
"@vgpu/wgsl": patch
---

Resolve bare package specifiers in WGSL *nominal type* positions. A struct imported from a package subpath — `import { VoronoiSample2 } from "@vgpu/wgsl-std/noise"` — can now type a binding, a struct member, a type alias or a function signature; previously only relative and root-alias imports resolved there, so reflection silently failed to find the struct and the binding came back without its `struct`/`layout` (member names, offsets and sizes). The value/function positions handled by the mangler were already correct, which is why the gap only showed up in reflected layouts.

`buildModuleSymbols()` now takes the same import resolver that loaded the module graph, so nominal types go through the identical resolution the loader used (relative, root alias, `packageMap`, `package.json` `exports`). `resolveShader()` passes its resolver through; when no resolver is available, or resolution throws, the previous relative/absolute heuristic still applies, so nothing that resolved before stops resolving.
