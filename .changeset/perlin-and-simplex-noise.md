---
"@vgpu/wgsl-std": minor
---

Add Perlin (`noise/perlin`) and Simplex (`noise/simplex`) noise, each with 2D/3D
base functions and amplitude-normalized FBM variants. Guaranteed `(-1, 1)` range,
table-free integer-hash gradients (bit-identical across backends), no seed
parameter (offset the input by >=2 units to decorrelate). See each module's
`index.docs.md` for measured range/variance/cost tables and a clouds recipe.
