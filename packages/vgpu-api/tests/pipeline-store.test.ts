import { afterEach, expect, test, vi } from "vitest";
import { getMockGPUDeviceInstrumentation } from "@vgpu/core";
import { init } from "../src/mock.ts";
import { InternalDraw } from "../src/draw.ts";
import { createPipelineStore, createShaderModuleCache, pipelineKeyOf, signatureKeyOf } from "../src/pipeline-store.ts";

const WGSL = `
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(pos[vi], 0.0, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }
`;

const VERTEX_WGSL = `
@vertex fn vs_main(@location(0) position: vec3f) -> @builtin(position) vec4f {
  return vec4f(position, 1.0);
}
@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }
`;

const GROUP_WGSL = `
struct Params { value: f32 }
@group(0) @binding(0) var<uniform> params: Params;
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var pos = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(pos[vi], 0.0, 1.0 + params.value * 0.0);
}
@fragment fn fs_main() -> @location(0) vec4f { return vec4f(1.0); }
`;

const VERTEX_LAYOUT_A: GPUVertexBufferLayout = {
  arrayStride: 12,
  attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
};

const VERTEX_LAYOUT_B: GPUVertexBufferLayout = {
  arrayStride: 16,
  attributes: [{ shaderLocation: 0, offset: 4, format: "float32x3" }],
};

afterEach(() => vi.restoreAllMocks());

test("device store dedupes byte-identical WGSL, layout, and signature across draws", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2] });
  const a = gpu.draw({ shader: WGSL, label: "dedupe-a" });
  const b = gpu.draw({ shader: WGSL, label: "dedupe-b" });

  a.draw(target);
  b.draw(target);
  await gpu.settled();

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createShaderModule).toBe(1);
  // Baseline before Task 02 was 2; shared device-level pipeline store should reduce this to 1.
  expect(mock.calls.createRenderPipeline).toBe(1);
  gpu.dispose();
});

test("different vertex buffer layouts do not collide", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2] });
  const a = gpu.draw({ shader: VERTEX_WGSL, label: "layout-a", mesh: { vertexBufferLayouts: [VERTEX_LAYOUT_A] } });
  const b = gpu.draw({ shader: VERTEX_WGSL, label: "layout-b", mesh: { vertexBufferLayouts: [VERTEX_LAYOUT_B] } });

  a.draw(target);
  b.draw(target);
  await gpu.settled();

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createShaderModule).toBe(1);
  expect(mock.calls.createRenderPipeline).toBe(2);
  gpu.dispose();
});

test("dynamic layout swap changes the pipeline key without clearing the store", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2] });
  const draw = gpu.draw({ shader: GROUP_WGSL, label: "dynamic-layout" }) as InternalDraw;

  draw.pipelineFor(target);
  draw.layout(0, { dynamicOffsets: true });
  draw.pipelineFor(target);

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createRenderPipeline).toBe(2);
  gpu.dispose();
});

test("blend and writeMask participate in shared pipeline cache keys", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2] });
  const a = gpu.draw({ shader: WGSL, label: "blend-a", blend: "alpha" });
  const b = gpu.draw({ shader: WGSL, label: "blend-b", blend: "additive" });
  const c = gpu.draw({ shader: WGSL, label: "blend-c", blend: "alpha" });
  const mask = gpu.draw({ shader: WGSL, label: "mask", writeMask: ["r", "g", "b"] });

  a.draw(target);
  b.draw(target);
  c.draw(target);
  mask.draw(target);

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createShaderModule).toBe(1);
  expect(mock.calls.createRenderPipeline).toBe(3);
  gpu.dispose();
});

test("cull and frontFace participate in shared pipeline cache keys", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2] });
  const a = gpu.draw({ shader: WGSL, label: "cull-a", cull: "back" });
  const b = gpu.draw({ shader: WGSL, label: "cull-b", cull: "front" });
  const c = gpu.draw({ shader: WGSL, label: "cull-c", cull: "back" });
  const face = gpu.draw({ shader: WGSL, label: "face", cull: "back", frontFace: "cw" });

  a.draw(target);
  b.draw(target);
  c.draw(target);
  face.draw(target);

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createShaderModule).toBe(1);
  expect(mock.calls.createRenderPipeline).toBe(3);
  gpu.dispose();
});

test("depth participates in shared pipeline cache keys", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2], depth: true });
  const a = gpu.draw({ shader: WGSL, label: "depth-a", depth: { compare: "greater" } });
  const b = gpu.draw({ shader: WGSL, label: "depth-b", depth: false });
  const c = gpu.draw({ shader: WGSL, label: "depth-c", depth: { compare: "greater" } });
  const d = gpu.draw({ shader: WGSL, label: "depth-d", depth: { compare: "greater", write: false } });

  a.draw(target);
  b.draw(target);
  c.draw(target);
  d.draw(target);

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createShaderModule).toBe(1);
  expect(mock.calls.createRenderPipeline).toBe(3);
  gpu.dispose();
});

test("stencil participates in shared pipeline cache keys; ref stays out", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2], depth: "depth24plus-stencil8" });
  const a = gpu.draw({ shader: WGSL, label: "st-a", stencil: { front: { compare: "equal", pass: "replace" } } });
  const b = gpu.draw({ shader: WGSL, label: "st-b", stencil: { front: { compare: "equal", pass: "replace" }, writeMask: 0xFF } });
  const c = gpu.draw({ shader: WGSL, label: "st-c", stencil: { front: { compare: "equal", pass: "replace" } } });
  const refOnlyDiff = gpu.draw({ shader: WGSL, label: "st-ref", stencil: { front: { compare: "equal", pass: "replace" }, ref: 7 } });
  const plain = gpu.draw({ shader: WGSL, label: "st-plain" });
  const empty = gpu.draw({ shader: WGSL, label: "st-empty", stencil: {} });

  a.draw(target);
  b.draw(target);
  c.draw(target);
  refOnlyDiff.draw(target);
  plain.draw(target);
  empty.draw(target);

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createShaderModule).toBe(1);
  // a/c share, ref-only difference shares with them, b is distinct, plain is distinct, and an all-defaults {} shares the plain key.
  expect(mock.calls.createRenderPipeline).toBe(3);
  gpu.dispose();
});

test("multisample participates in shared pipeline cache keys", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2], msaa: true });
  const a = gpu.draw({ shader: WGSL, label: "ms-a", multisample: { alphaToCoverage: true } });
  const b = gpu.draw({ shader: WGSL, label: "ms-b", multisample: { mask: 0b0101 } });
  const c = gpu.draw({ shader: WGSL, label: "ms-c", multisample: { alphaToCoverage: true } });
  const plain = gpu.draw({ shader: WGSL, label: "ms-plain" });
  const empty = gpu.draw({ shader: WGSL, label: "ms-empty", multisample: {} });

  a.draw(target);
  b.draw(target);
  c.draw(target);
  plain.draw(target);
  empty.draw(target);

  const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
  expect(mock.calls.createShaderModule).toBe(1);
  // a/c share, b is distinct, plain is distinct, and an all-defaults {} shares the plain key.
  expect(mock.calls.createRenderPipeline).toBe(3);
  gpu.dispose();
});

test("pipelineKeyOf appends fragmentKey only when present", () => {
  const module = {} as GPUShaderModule;
  const pipelineLayout = {} as GPUPipelineLayout;
  const parts = { module, pipelineLayout, signature: { colors: ["rgba8unorm"] as const } };
  const base = pipelineKeyOf(parts);

  expect(pipelineKeyOf({ ...parts, fragmentKey: undefined })).toBe(base);
  expect(pipelineKeyOf({ ...parts, fragmentKey: "none;none;7" })).toBe(`${base}|none;none;7`);
});

test("sync pipeline creation wins a pending async create and suppresses late native rejection", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2] });
  const store = createPipelineStore(gpu.device);
  const modules = createShaderModuleCache(gpu.device);
  const draw = new InternalDraw(gpu.device, WGSL, { shader: WGSL, label: "sync-wins" }, undefined, undefined, store, modules);
  const lateNativeError = new Error("late native compile failed");
  let rejectNative!: (error: unknown) => void;
  vi.spyOn(gpu.device.gpu, "createRenderPipelineAsync").mockImplementation((desc: GPURenderPipelineDescriptor) => {
    getMockGPUDeviceInstrumentation(gpu.device.gpu).calls.createRenderPipelineAsync += 1;
    getMockGPUDeviceInstrumentation(gpu.device.gpu).createRenderPipelineAsyncDescriptors.push(desc);
    return new Promise<GPURenderPipeline>((_resolve, reject) => { rejectNative = reject; });
  });
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
  process.on("unhandledRejection", onUnhandled);

  try {
    const pending = draw.pipelineForAsync(target);
    const syncPipeline = draw.pipelineFor(target);
    await expect(pending).resolves.toBe(syncPipeline);
    rejectNative(lateNativeError);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const mock = getMockGPUDeviceInstrumentation(gpu.device.gpu);
    expect(mock.calls.createRenderPipelineAsync).toBe(1);
    expect(mock.calls.createRenderPipeline).toBe(1);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    store.dispose();
    modules.dispose();
    gpu.dispose();
  }
});

test("disposing the store rejects pending async compiles with VGPU-COMPILE-DISPOSED", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2] });
  const store = createPipelineStore(gpu.device);
  const modules = createShaderModuleCache(gpu.device);
  const draw = new InternalDraw(gpu.device, WGSL, { shader: WGSL, label: "dispose-pending" }, undefined, undefined, store, modules);
  vi.spyOn(gpu.device.gpu, "createRenderPipelineAsync").mockImplementation(() => new Promise<GPURenderPipeline>(() => undefined));

  const pending = draw.pipelineForAsync(target);
  store.dispose();

  await expect(pending).rejects.toMatchObject({ code: "VGPU-COMPILE-DISPOSED" });
  modules.dispose();
  gpu.dispose();
});

test("signatureKeyOf matches the pre-store draw key", async () => {
  const gpu = await init();
  const target = gpu.target({ size: [2, 2], format: "rgba8unorm", depth: "depth24plus", msaa: true });
  expect(signatureKeyOf({ colors: target.colors.map((color) => color.format), depth: target.depth?.format, sampleCount: target.sampleCount }))
    .toBe(`${target.colors.map((color) => color.format).join(",")}:${target.depth?.format ?? "none"}:${target.sampleCount}`);
  gpu.dispose();
});
