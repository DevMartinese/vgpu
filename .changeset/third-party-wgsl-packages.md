---
"@vgpu/wgsl": minor
---

WGSL package imports now resolve third-party and workspace packages in every install layout. A package that exports `.wgsl` files through its `exports` map (the same shape `@vgpu/wgsl-std` uses) already worked when installed as a direct dependency under npm and pnpm, including a `workspace:*` package linked into an app in a monorepo, but two layouts failed with `VGPU-WGSL-PKG-NOTFOUND`:

- **A WGSL package that imports another WGSL package under pnpm.** The importing module lives in `node_modules/.pnpm/<pkg>@<version>/node_modules/<pkg>`, reached through a symlink, and its own dependencies are installed next to that store entry — never next to the symlink, so the `node_modules` walk could not see them. The walk now also runs from the importing file's real path, which is how Node itself resolves.
- **Yarn PnP.** PnP keeps packages inside zip archives with no `node_modules` directories to walk. When the PnP runtime is active in the process (any `yarn`-launched build), the resolver now asks Node to resolve the specifier *from the importing shader*, which hits Yarn's resolver and returns a zip-internal path that PnP's patched `fs` can read.

Resolution precedence is unchanged: the importing project's own `node_modules` still wins, the walk still stops at the workspace root, and the `@vgpu/*`-scoped fallback that rescues `@vgpu/wgsl-std` from an isolated layout still runs last. The new PnP step resolves from the *user's* file, so it can only reach what the shader's own package declares.
