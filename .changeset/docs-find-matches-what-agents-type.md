---
"@vgpu/cli": patch
---

`vgpu docs find` now answers multi-word and prose queries. Every whitespace-separated word must match, matching covers page titles and the `keywords` a page declares in its frontmatter, and when none of that hits it falls back to searching page bodies — so `find "wgsl loader"`, `find "typescript wgsl import"`, and `find VGPU-WGSL-PKG-NOTFOUND` resolve to a page instead of printing `No docs found`.
