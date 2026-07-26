import { expect, test, vi } from "vitest";
import { createMockGPUDevice, Device } from "@vgpu/core";
import { createQueryRing } from "../src/query-ring.ts";

interface ControlledMaps {
  readonly device: Device;
  /** One resolver per started staging mapAsync, in start order. */
  readonly resolvers: Array<() => void>;
}

/** Mock device whose staging-buffer mapAsync promises resolve only when the test says so. */
function createControlledDevice(): ControlledMaps {
  const gpu = createMockGPUDevice();
  const resolvers: Array<() => void> = [];
  const originalCreateBuffer = gpu.createBuffer.bind(gpu);
  vi.spyOn(gpu, "createBuffer").mockImplementation((descriptor: GPUBufferDescriptor) => {
    const buffer = originalCreateBuffer(descriptor);
    if (descriptor.label?.includes("staging")) {
      (buffer as { mapAsync: GPUBuffer["mapAsync"] }).mapAsync = () => new Promise<undefined>((resolve) => { resolvers.push(() => resolve(undefined)); });
    }
    return buffer;
  });
  return { device: new Device(gpu), resolvers };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("encodeResolve resolves the contiguous used range and copies into the rotating staging buffer", () => {
  const { device } = createControlledDevice();
  const ring = createQueryRing(device, { type: "timestamp", capacity: 8, label: "ring" });
  const ops: Array<readonly unknown[]> = [];
  const wrapped = {
    resolveQuerySet: (...args: unknown[]) => { ops.push(["resolveQuerySet", args[1], args[2], args[4]]); },
    copyBufferToBuffer: (...args: unknown[]) => { ops.push(["copyBufferToBuffer", args[1], args[3], args[4]]); },
  } as unknown as GPUCommandEncoder;

  expect(ring.encodeResolve(wrapped, 0)).toBe(false);
  expect(ring.encodeResolve(wrapped, 6)).toBe(true);
  expect(ops).toEqual([
    ["resolveQuerySet", 0, 6, 0],
    ["copyBufferToBuffer", 0, 0, 6 * 8],
  ]);
  expect(ring.querySet.type).toBe("timestamp");
  expect(ring.capacity).toBe(8);
  ring.dispose();
  vi.restoreAllMocks();
});

test("readbacks decode the staged u64 values and skip resolving while all staging buffers are map-pending", async () => {
  const { device, resolvers } = createControlledDevice();
  const ring = createQueryRing(device, { type: "timestamp", capacity: 8, label: "ring", depth: 2 });
  const applied: BigUint64Array[] = [];
  const encoder = device.gpu.createCommandEncoder();

  expect(ring.encodeResolve(encoder, 2)).toBe(true);
  ring.onSubmitted((values) => applied.push(values));
  expect(ring.encodeResolve(encoder, 4)).toBe(true);
  ring.onSubmitted((values) => applied.push(values));
  // Depth 2 and both staging buffers map-pending: drop the frame's resolve entirely, never block.
  expect(ring.encodeResolve(encoder, 2)).toBe(false);
  ring.onSubmitted(() => { throw new Error("skipped resolves must not read back"); });

  resolvers[0]!();
  resolvers[1]!();
  await flushMicrotasks();
  // Mock fake value for query i is i*i * 1e6.
  expect(applied.map((values) => [...values])).toEqual([
    [0n, 1_000_000n],
    [0n, 1_000_000n, 4_000_000n, 9_000_000n],
  ]);
  // With a staging buffer free again, resolving resumes.
  expect(ring.encodeResolve(encoder, 2)).toBe(true);
  ring.dispose();
  vi.restoreAllMocks();
});

test("a stale readback that lands after a newer one is discarded", async () => {
  const { device, resolvers } = createControlledDevice();
  const ring = createQueryRing(device, { type: "timestamp", capacity: 8, label: "ring", depth: 3 });
  const applied: number[] = [];
  const encoder = device.gpu.createCommandEncoder();

  ring.encodeResolve(encoder, 2);
  ring.onSubmitted((values) => applied.push(values.length));
  ring.encodeResolve(encoder, 4);
  ring.onSubmitted((values) => applied.push(values.length));

  // The newer readback lands first; the older one lands afterwards and must be discarded.
  resolvers[1]!();
  await flushMicrotasks();
  resolvers[0]!();
  await flushMicrotasks();

  expect(applied).toEqual([4]);
  ring.dispose();
  vi.restoreAllMocks();
});

test("dispose defers destruction until in-flight readbacks settle and still applies them", async () => {
  const { device, resolvers } = createControlledDevice();
  const destroyed: string[] = [];
  const originalCreateQuerySet = device.gpu.createQuerySet.bind(device.gpu);
  vi.spyOn(device.gpu, "createQuerySet").mockImplementation((descriptor: GPUQuerySetDescriptor) => {
    const querySet = originalCreateQuerySet(descriptor);
    const originalDestroy = querySet.destroy.bind(querySet);
    querySet.destroy = () => { destroyed.push("querySet"); originalDestroy(); };
    return querySet;
  });
  const ring = createQueryRing(device, { type: "timestamp", capacity: 4, label: "ring" });
  const applied: number[] = [];
  const encoder = device.gpu.createCommandEncoder();

  ring.encodeResolve(encoder, 2);
  ring.onSubmitted((values) => applied.push(values.length));
  ring.dispose();
  // A consumer retiring a ring (capacity growth) must not lose results already submitted.
  expect(destroyed).toEqual([]);
  resolvers[0]!();
  await flushMicrotasks();
  expect(applied).toEqual([2]);
  expect(destroyed).toEqual(["querySet"]);
  // Disposed rings refuse new work.
  expect(ring.encodeResolve(encoder, 2)).toBe(false);
  vi.restoreAllMocks();
});

test("pending readbacks register with trackSettled so gpu.settled() covers them", async () => {
  const { device, resolvers } = createControlledDevice();
  const tracked: Promise<unknown>[] = [];
  const ring = createQueryRing(device, { type: "timestamp", capacity: 4, label: "ring", trackSettled: (promise) => tracked.push(promise) });
  const encoder = device.gpu.createCommandEncoder();

  ring.encodeResolve(encoder, 2);
  ring.onSubmitted(() => undefined);
  expect(tracked).toHaveLength(1);
  let settled = false;
  void tracked[0]!.then(() => { settled = true; });
  await flushMicrotasks();
  expect(settled).toBe(false);
  resolvers[0]!();
  await flushMicrotasks();
  expect(settled).toBe(true);
  ring.dispose();
  vi.restoreAllMocks();
});
