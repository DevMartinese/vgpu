# Draw

Target-agnostic renderable shader unit created by `gpu.draw()`. It reflects WGSL bindings, caches pipelines per target format/depth/sample count, and supports meshes, explicit vertex counts, instancing, and raw group claims.

## Import

```ts
import type { DepthOptions, Draw, DrawOptions, DrawCallOptions, DrawLayoutOptions, MeshLike, StencilFaceOptions, StencilOptions } from "vgpu";
```

## Signature

```ts
import type { ShaderSource, Target, TargetSignature } from "vgpu";

type SetBag = Record<string, unknown>;

type BlendPreset = "alpha" | "additive" | "premultiplied";
interface BlendComponentOptions { readonly src: GPUBlendFactor; readonly dst: GPUBlendFactor; readonly op?: GPUBlendOperation; }
interface BlendOptions { readonly color: BlendComponentOptions; readonly alpha?: BlendComponentOptions; }

interface DepthOptions {
  readonly write?: boolean;
  readonly compare?: GPUCompareFunction;
  readonly bias?: number;
  readonly biasSlopeScale?: number;
  readonly biasClamp?: number;
}

interface StencilFaceOptions {
  readonly compare?: GPUCompareFunction;
  readonly fail?: GPUStencilOperation;
  readonly depthFail?: GPUStencilOperation;
  readonly pass?: GPUStencilOperation;
}

interface StencilOptions {
  readonly front?: StencilFaceOptions;
  readonly back?: StencilFaceOptions;
  readonly readMask?: number;
  readonly writeMask?: number;
  readonly ref?: number;
}

interface DrawOptions {
  readonly shader: string | ShaderSource;
  readonly mesh?: MeshLike;
  readonly set?: SetBag;
  readonly label?: string;
  readonly targets?: readonly Target[];
  readonly instances?: number;
  readonly vertices?: number;
  readonly firstInstance?: number;
  readonly blend?: BlendPreset | BlendOptions;
  readonly blendConstant?: readonly [number, number, number, number];
  readonly writeMask?: readonly ("r" | "g" | "b" | "a")[];
  readonly colors?: readonly ({ readonly blend?: BlendPreset | BlendOptions; readonly writeMask?: readonly ("r" | "g" | "b" | "a")[] } | null)[];
  readonly cull?: "none" | "front" | "back";
  readonly frontFace?: "ccw" | "cw";
  readonly unclippedDepth?: boolean;
  readonly depth?: false | DepthOptions;
  readonly stencil?: StencilOptions;
  readonly multisample?: { readonly alphaToCoverage?: boolean; readonly mask?: number };
  readonly constants?: Readonly<Record<string, number | boolean>>;
}

interface DrawCallOptions {
  readonly target?: Target;
  readonly offsets?: readonly number[] | Partial<Record<number, readonly number[]>>;
  readonly instances?: number;
  readonly vertices?: number;
  readonly firstVertex?: number;
  readonly firstInstance?: number;
}

interface DrawLayoutOptions { readonly dynamicOffsets?: boolean; }

interface MeshLike {
  readonly vertexCount?: number;
  readonly indexCount?: number;
  readonly vertexBuffers?: readonly GPUBuffer[];
  readonly indexBuffer?: GPUBuffer;
  readonly indexFormat?: GPUIndexFormat;
  readonly vertexBufferLayouts?: readonly GPUVertexBufferLayout[];
}

interface Draw {
  readonly gpu: GPURenderPipeline | undefined;
  readonly targets: readonly Target[] | undefined;
  set(values: SetBag): this;
  group(n: number, bindGroup: GPUBindGroup): this;
  layout(n: number, opts?: DrawLayoutOptions): GPUBindGroupLayout;
  draw(target?: Target | DrawCallOptions): void;
  compile(target?: Target | TargetSignature): Promise<this>;
  compileSync(target?: Target | TargetSignature): this;
}
```

## Parameters

| Param | Type | Required | Default | Notes |
|---|---|---:|---|---|
| opts.shader | `string \| ShaderSource` | ✔ | — | WGSL string or loader-produced `ShaderSource`. Must contain compatible vertex/fragment entry points; default names are `vs_main` and `fs_main` if reflection does not find them. |
| opts.mesh | `MeshLike` | ✖ | `undefined` | Supplies vertex/index buffers and layouts. Omit for generated vertex-index drawing. |
| opts.set | `Record<string, unknown>` | ✖ | `undefined` | Initial `.set()` call. |
| opts.label | `string` | ✖ | `"draw"` | Debug/error label. |
| opts.targets | `readonly Target[]` | ✖ | `undefined` | Synchronous pre-warm sugar for the listed target signatures. In browser load paths, prefer `await draw.compile(target)`. |
| opts.instances | `number` | ✖ | `1` | Default instance count. Integer `>= 0`; per-call `instances` overrides. |
| opts.vertices | `number` | ✖ | `3` for non-indexed, unless `mesh.vertexCount` exists | Default non-indexed vertex count. Ignored by indexed meshes. Integer `>= 0`. |
| opts.firstInstance | `number` | ✖ | `0` | Default first instance. Integer `>= 0`; per-call `firstInstance` overrides. |
| opts.blend | `"alpha" \| "additive" \| "premultiplied" \| BlendOptions` | ✖ | `undefined` | Constructor-only blend state applied uniformly to every color target. Presets resolve at construction; explicit components use `src`/`dst` and optional `op` (`"add"` default). Omitted `alpha` copies `color`. |
| opts.blendConstant | `readonly [number, number, number, number]` | ✖ | pass default `(0, 0, 0, 0)` | Constructor-only blend constant used by `"constant"`/`"one-minus-constant"` blend factors. Emitted as encoder state (`setBlendConstant`) before this draw; not part of the pipeline. Requires a `blend` that uses a constant factor; components may lie outside `[0, 1]` but must be finite. |
| opts.writeMask | `readonly ("r" \| "g" \| "b" \| "a")[]` | ✖ | all channels | Constructor-only color channel mask applied uniformly to every color target. Omit to write RGBA; `[]` writes no channels; `["r","g","b"]` skips alpha. |
| opts.colors | `readonly ({ blend?, writeMask? } \| null)[]` | ✖ | `undefined` | Constructor-only per-color-target blend/writeMask overrides for MRT, aligned by index with the target's color attachments. `null`/missing entries — and omitted fields of an entry — inherit the top-level `blend`/`writeMask`. `{ writeMask: [] }` silences one attachment. The length must match the target signature's color count. |
| opts.cull | `"none" \| "front" \| "back"` | ✖ | `"none"` | Constructor-only face culling applied to this draw's pipelines. Omit for no culling. |
| opts.frontFace | `"ccw" \| "cw"` | ✖ | `"ccw"` | Constructor-only winding that counts as front-facing. Omit for counter-clockwise. |
| opts.unclippedDepth | `boolean` | ✖ | `false` | Constructor-only. Disables depth clipping so geometry outside `[near, far]` is not clipped. Requires the `"depth-clip-control"` device feature — request it with `init({ requiredFeatures: ["depth-clip-control"] })`. `false` behaves exactly like omitting the option. |
| opts.depth | `false \| DepthOptions` | ✖ | `{ write: true, compare: "less-equal" }` | Constructor-only depth state for targets with a depth attachment; ignored when the target has no depth. `false` disables depth testing (`write: false`, `compare: "always"`). `bias` must be an integer; the bias family must be `0`/omitted for point/line topologies. |
| opts.stencil | `StencilOptions` | ✖ | WebGPU pass-through defaults | Constructor-only stencil state for targets whose depth format has a stencil aspect (e.g. `depth: "depth24plus-stencil8"`). Faces default to `{ compare: "always", fail/depthFail/pass: "keep" }`; omitted `back` mirrors the normalized `front`; `readMask`/`writeMask` are integers in `[0, 0xFFFFFFFF]` defaulting to `0xFFFFFFFF`. `ref` (default pass value `0`) is encoder state (`setStencilReference`), not pipeline state. |
| opts.multisample | `{ alphaToCoverage?, mask? }` | ✖ | `{ alphaToCoverage: false, mask: 0xFFFFFFFF }` | Constructor-only multisample state. `alphaToCoverage` converts fragment alpha into a coverage mask and requires an MSAA target (`msaa: true`). `mask` is a sample bitmask (integer in `[0, 0xFFFFFFFF]`); only the low `sampleCount` bits matter — higher bits are legal and ignored. |
| opts.constants | `Readonly<Record<string, number \| boolean>>` | ✖ | WGSL defaults | Constructor-only values for WGSL `override` constants, applied to both the vertex and fragment stages. Key by override name, or by the decimal string of `N` when the declaration has `@id(N)` (the name is not usable then). Values must be finite numbers or booleans (booleans become `1`/`0`); every override declared without a default must be provided. |
| draw.set.values | `Record<string, unknown>` | ✔ | — | Values keyed by WGSL binding variable name. JS objects/numbers are packed; resources are bound by identity. |
| draw.group.n | `number` | ✔ | — | Bind group index to claim for manual bind-group binding (`group(n, bindGroup)`). |
| draw.group.bindGroup | `GPUBindGroup` | ✔ | — | Must be compatible with `draw.layout(n)` or `draw.layout(n, { dynamicOffsets: true })`. |
| draw.layout.n | `number` | ✔ | — | Reflected bind group index. |
| draw.layout.opts.dynamicOffsets | `boolean` | ✖ | `false` | When `true`, returns/reuses a layout whose buffer entries have `hasDynamicOffset: true` and clears cached pipelines. |
| draw.draw.target | `Target \| DrawCallOptions` | ✖ | `{}` | One-shot draw options. Pass a bare target for the common case, or an options bag when setting counts or offsets. |
| opts.target | `Target` | ✖ | — | Required at runtime when an options bag is used. Use a `Surface` or an offscreen `Target`. |
| opts.offsets | `readonly number[] \| Partial<Record<number, readonly number[]>>` | ✖ | Reflected/claimed fallback offsets | Dynamic offsets for claimed/dynamic groups. Array applies to every group; object keys by group. |
| opts.instances | `number` | ✖ | `DrawOptions.instances ?? 1` | Per-call instance count; integer `>= 0`. |
| opts.vertices | `number` | ✖ | `mesh.vertexCount ?? DrawOptions.vertices ?? 3` | Per-call non-indexed vertex count; indexed meshes use `mesh.indexCount`. |
| opts.firstVertex | `number` | ✖ | `0` | Non-indexed first vertex; indexed meshes use firstIndex/baseVertex `0`. |
| opts.firstInstance | `number` | ✖ | `DrawOptions.firstInstance ?? 0` | Per-call first instance. |

**Returns:** `gpu.draw()` returns `Draw`; `set()`, `group()`, and `compileSync()` return the same `Draw`; `layout()` returns a `GPUBindGroupLayout`; one-shot `draw()` returns `void`; `compile()` returns `Promise<this>`.

Bindings remain present in reflected layouts, but their `visibility` is the union of static use by the selected vertex and fragment entry points. Unused declarations have visibility `0`. Build claimed bind groups from `draw.layout(group)` rather than guessing a raw layout; a raw layout matching the old broad visibility is not group-equivalent.

**Throws:** `VGPU-LIMIT-STORAGE-VERTEX` or `VGPU-LIMIT-STORAGE-FRAGMENT` before bind-group-layout creation when actual static use exceeds the granted stage limit (request the supported `requiredLimits` value or reduce/move the storage data); `VGPU-TARGET-REQUIRED` when `draw.draw()` is called without `target`; `VGPU-BLEND-INVALID` for an unknown blend preset or malformed blend object; `VGPU-BLEND-CONSTANT-INVALID` for a blendConstant that is not exactly four finite numbers, or one whose `blend` uses no `"constant"`/`"one-minus-constant"` factor (the option would have no effect); `VGPU-WRITEMASK-INVALID` for a non-array or unknown write mask channel; `VGPU-COLORS-INVALID` for a non-array `colors`, an entry that is neither `null` nor a `{ blend?, writeMask? }` object, or — at compile/draw time against a resolved target signature — a `colors` length that differs from the signature's color attachment count (both counts are in the message; `targets: [...]` compiles at construction, so the mismatch surfaces from `gpu.draw` itself); `VGPU-CULL-INVALID` for an unknown cull mode; `VGPU-FRONTFACE-INVALID` for an unknown front-face winding; `VGPU-UNCLIPPED-DEPTH-INVALID` for a non-boolean `unclippedDepth`, or `unclippedDepth: true` on a device whose `features` lacks `"depth-clip-control"` (request it with `init({ requiredFeatures: ["depth-clip-control"] })` on an adapter that supports it); `VGPU-DEPTH-INVALID` for a malformed depth option (non-boolean `write`, unknown `compare`, non-integer `bias`, non-finite bias values, or nonzero bias values with a point/line topology); `VGPU-STENCIL-INVALID` for a malformed `stencil` option (non-object value, malformed `front`/`back` face, unknown `compare` or `fail`/`depthFail`/`pass` operation, or `readMask`/`writeMask`/`ref` outside integer `[0, 0xFFFFFFFF]`), or — at compile/draw time against a resolved target signature — any `stencil` state against a depth format without a stencil aspect (use `depth: "depth24plus-stencil8"` on the target; `targets: [...]` compiles at construction, so that mismatch surfaces from `gpu.draw` itself); `VGPU-MULTISAMPLE-INVALID` for a malformed `multisample` option (non-object value, non-boolean `alphaToCoverage`, or a `mask` that is not an integer in `[0, 0xFFFFFFFF]`), or — at compile/draw time against a resolved target signature — `alphaToCoverage: true` with a non-MSAA signature (create the target with `msaa: true`; `targets: [...]` compiles at construction, so that mismatch surfaces from `gpu.draw` itself); `VGPU-CONSTANTS-INVALID` for a malformed `constants` option (non-object value, a key that matches no override in the shader — the message lists the available overrides — or a value that is neither a finite number nor a boolean), and for an override declared without a default that `constants` does not provide; `VGPU-R1-DRAW-COUNT` when any count field is not an integer `>= 0`; `VGPU-R1-BINDING-NEVER-SET`, `VGPU-R1-OWNERSHIP-FLIP`, and `VGPU-R1-BINDING-INCOMPATIBLE-RESOURCE` from `set()`/draw preflight; `VGPU-SET-TEXTURE-FILTERABILITY` when a facade texture format cannot satisfy an ordinarily sampled `float` binding (detail identifies the format, texture and paired sampler; use a filterable format, request `float32-filterable`, or rewrite to `textureLoad`); `VGPU-R4-GROUP-CLAIMED`, `VGPU-R4-GROUP-INCOMPATIBLE`, or `VGPU-R4-GROUP-VALIDATION` for raw claimed bind groups; `VGPU-SHADER-SOURCE-INVALID` for malformed `ShaderSource`.

## Examples

```ts
import { init } from "vgpu/mock";

const gpu = await init();
const target = gpu.target({ size: [64, 64] });
const tri = gpu.draw({
  label: "tri",
  targets: [target],
  shader: `
    @vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
      var p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3));
      return vec4f(p[vi], 0, 1);
    }
    @fragment fn fs_main() -> @location(0) vec4f { return vec4f(0, 1, 0, 1); }
  `,
});

tri.draw({ target, vertices: 3, instances: 1 });
```

## Pipeline pre-warm

`draw.compile(target)` asynchronously prepares one target signature and resolves to the same draw. `draw.compileSync(target)` prepares the same signature synchronously; if an async compile for that signature is still pending, the synchronous result wins the race and unblocks later draws. Both methods also accept a target signature object such as `{ colors: ["bgra8unorm"], depth: "depth24plus", sampleCount: 4 }`; `colors` is required and bare strings are rejected.

Each color/depth/sample-count variant is a different pipeline. A missed variant sync-compiles on first use, which can jank; fire-and-forget pre-warms should always use `.catch(...)` or `gpu.onError`/`gpu.settled()` will not observe the returned promise rejection. `targets: [target]` is kept as creation-time `compileSync()` sugar for non-browser hot paths.

## Notes

- Count precedence is per-call option, then draw option, then mesh/default. `instances: 0` and `vertices: 0` are valid no-op draws.
- Blend, write masks, face culling, and depth state are immutable pipeline state, fixed at `gpu.draw()` construction. Top-level `blend` and `writeMask` apply uniformly to all color targets; `colors` overrides them per attachment for MRT draws (G-buffers via `gpu.target({ colors: [...] })`). Overrides are per field: an entry with only `blend` still inherits the top-level `writeMask`. Draws that differ only in `colors` compile distinct pipelines.
- `cull` and `frontFace` map to `GPUPrimitiveState.cullMode`/`frontFace`. Draws that differ only in culling compile distinct pipelines; omitting both keeps the WebGPU defaults (`"none"`, `"ccw"`).
- `unclippedDepth` maps to `GPUPrimitiveState.unclippedDepth` and requires the `"depth-clip-control"` device feature, checked against `device.features` at construction. It is emitted only when `true`, so draws without it — or with an explicit `false` — keep byte-identical descriptors and pipeline cache keys; draws that differ only in `unclippedDepth` compile distinct pipelines. Fragment depth is still clamped to the viewport `[minDepth, maxDepth]` range at output.
- `depth` maps to `GPUDepthStencilState` on targets with a depth attachment (`write` → `depthWriteEnabled`, `compare` → `depthCompare`, `bias`/`biasSlopeScale`/`biasClamp` → the `depthBias` family). Omitted, it defaults to `{ write: true, compare: "less-equal" }`; `depth: false` compiles `{ depthWriteEnabled: false, depthCompare: "always" }` because WebGPU cannot omit depth state when the pass has a depth attachment. Draws that differ only in depth state compile distinct pipelines. Use `clearDepth: 0` on the pass plus `depth: { compare: "greater" }` for reversed-Z.
- `stencil` maps to `GPUDepthStencilState` stencil members on targets whose depth format has a stencil aspect (`front`/`back` → `stencilFront`/`stencilBack` with `compare` → `compare`, `fail` → `failOp`, `depthFail` → `depthFailOp`, `pass` → `passOp`; `readMask`/`writeMask` → `stencilReadMask`/`stencilWriteMask`). It merges into the same depth-stencil state as `depth` — stencil without a `depth` option keeps the depth defaults. Omitted `back` mirrors the normalized `front` so both faces behave the same; `front` omitted with `back` given keeps the WebGPU face defaults for the front. Unset fields stay omitted from the descriptor, so draws without the option keep byte-identical pipelines and cache keys; draws that differ only in stencil state (everything except `ref`) compile distinct pipelines. `ref` is encoder state, emitted as `setStencilReference` after `setPipeline` and before the draw — only when provided, including an explicit `0` — and draws that differ only in `ref` share pipelines. Render bundles cannot record draws whose stencil has `ref` (bundle encoders cannot set the pass stencil reference; `VGPU-BUNDLE-STENCIL-REF`); stencil without `ref` records fine.
- `multisample` maps to `GPUMultisampleState` (`alphaToCoverage` → `alphaToCoverageEnabled`, `mask` → `mask`; the sample `count` always comes from the target's `sampleCount`). Unset fields are omitted from the descriptor, so draws without the option — or with an all-defaults `{}` — keep today's pipelines and cache keys. Draws that differ only in multisample state compile distinct pipelines. WebGPU requires the first color target to be blendable with an alpha channel when `alphaToCoverage` is on, and forbids combining it with a fragment `sample_mask` output; native validation reports those.
- `constants` maps to `GPUProgrammableStage.constants` of both the vertex and fragment stages — WebGPU matches keys against the module's override declarations, not per entry point, so one record serves both stages even when an override is referenced by only one of them. An override with `@id(N)` is keyed by the decimal string of `N`; all others by name. Booleans convert to `1`/`0` (WebGPU converts the double to the override's WGSL type: bool/i32/u32/f32/f16), so `true` and `1` share pipelines. Draws that differ only in `constants` compile distinct pipelines; an absent option — or an empty `{}` — keeps byte-identical descriptors and cache keys.
- `blendConstant` is encoder state, not pipeline state: it is emitted as `setBlendConstant` after `setPipeline` and before the draw, and draws that differ only in `blendConstant` share pipelines. Constant blend factors without `blendConstant` are legal and use the WebGPU pass default `(0, 0, 0, 0)`. Render bundles cannot record draws with `blendConstant` — bundle encoders cannot set render-pass blend state — so `gpu.bundle` rejects them with `VGPU-BUNDLE-BLEND-CONSTANT`; encode such draws in a frame pass instead.
- Blend presets: `"alpha"` uses source alpha over, `"premultiplied"` uses premultiplied source over, and `"additive"` uses one-plus-one additive blending for color and alpha. In explicit blends, `op` defaults to `"add"` and omitted `alpha` copies `color`.
- One-shot `draw.draw()` has no implicit target and returns `void`; raw claimed-group validation errors are delivered through `gpu.onError`, and tests can `await gpu.settled()`.
- Changing resource identity after a draw is recorded in a `Bundle` marks that bundle stale; changing JS values in-place does not.
- **See also:** `Effect`, `FramePass.draw`, `Bundle`, `Surface`, `Target`, `SharedUniforms`.
