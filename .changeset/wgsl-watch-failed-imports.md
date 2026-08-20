---
"@vgpu/wgsl": patch
---

Keep imported WGSL files registered with webpack/Turbopack and Vite when shader resolution fails, allowing a later valid save to rebuild failed importers without restarting the dev server.
