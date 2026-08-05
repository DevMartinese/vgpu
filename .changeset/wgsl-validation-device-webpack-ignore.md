---
"@vgpu/wgsl": patch
---

Fix the lazy `@vgpu/adapter-node` import in the validation device loader so bundlers can see it's an
ordinary package specifier: it now uses a literal specifier (typed via a local ambient module
declaration) instead of a variable, so `tsc` no longer wraps it in its
`__rewriteRelativeImportExtension` helper. That wrapper was invisible to both webpack's module
parser and Next.js's build-dependency cache scanner, so every consumer that bundles the loader saw
two spurious warnings per build ("Critical dependency: the request of a dependency is an
expression" during the webpack ESM build-dependency scan, plus "Build dependencies behind this
expression are ignored and might cause incorrect cache invalidation"). The dynamic import still
only runs in Node and behaves identically at runtime.
