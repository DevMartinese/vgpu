---
"@vgpu/wgsl": patch
---

The transitive-resolution fallback in `resolveImport` is now scoped to `@vgpu/*` specifiers. That fallback (`resolveAlongsideResolver`) exists only to rescue `@vgpu/wgsl`'s own transitive dependencies (like `@vgpu/wgsl-std`) in isolated pnpm/PnP layouts, but it previously ran for any bare specifier that failed the project-local `node_modules` walk. That meant a mistyped or unrelated WGSL import (e.g. `webpack`, a devDependency of `@vgpu/wgsl` itself) could resolve to the real installed JS file and fail later with a confusing `VGPU-WGSL-REFLECT-PARSE Expected identifier`, instead of the clear `VGPU-WGSL-PKG-NOTFOUND` (with its install fix-it) that non-`@vgpu` specifiers should get.
