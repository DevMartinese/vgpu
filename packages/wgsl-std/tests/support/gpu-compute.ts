import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createNodeAdapter } from "@vgpu/adapter-node";
import { resolveShader } from "@vgpu/wgsl/runtime";

/**
 * Reusable Dawn compute-shader readback harness for the wgsl-std noise modules.
 *
 * Generalized from `runMathCompute` (`packages/wgsl-std/tests/math.test.ts`): it resolves an
 * in-memory entry point that imports the module under test, runs it in a single workgroup and maps
 * the resulting `array<f32, N>` storage buffer back to the host. This is the only mechanism that
 * binds the *actual WGSL* to the f32-exact TS reference in `./hash-reference.ts`.
 *
 * The harness itself is not gated: callers wrap invocations in
 * `test.skipIf(process.env.VGPU_DOCKER_TEST !== "1")`, exactly like the existing suites, because a
 * real GPU device is only available inside the Docker/Xvfb image that CI's `test-integration` job
 * builds.
 *
 * Resolution notes (verified against `packages/wgsl/src/runtime/package-resolution.ts`):
 *   * because `modules` is provided, resolution runs in *virtual-fs* mode: every reachable module
 *     must be present in the `modules` map (relative imports included) and every bare package
 *     specifier must match a `packageMap` prefix -- there is no disk fallback for path resolution.
 *   * that is why `@vgpu/wgsl-std/hash` and `src/noise/internal/gradient.wgsl` are pre-seeded here:
 *     every noise module reaches them (perlin/simplex import the gradient core relatively, which in
 *     turn imports the hash package). Unreachable seeds are inert -- `loadGraph` only walks actual
 *     imports -- so this costs nothing for callers that do not need them.
 */
export interface RunNoiseComputeArgs {
  /** Absolute path of the `.wgsl` module under test, e.g. `resolve("packages/wgsl-std/src/noise/perlin/index.wgsl")`. */
  readonly modulePackagePath: string;
  /** Specifier the generated entry point imports it as, e.g. `"@vgpu/wgsl-std/noise/perlin"`. */
  readonly packageSubpath: string;
  /** Symbols imported from `packageSubpath` into the entry point, e.g. `["perlin2d", "fbmPerlin3d"]`. */
  readonly imports: readonly string[];
  /** Extra real `.wgsl` files to seed into the virtual fs, keyed by their absolute on-disk path. */
  readonly extraModulePaths?: readonly string[];
  /** Extra specifier -> absolute path entries, merged into the `packageMap`. */
  readonly extraPackageMap?: Readonly<Record<string, string>>;
  /** Number of `f32` slots in the output buffer (`out.values`). */
  readonly outputLength: number;
  /** WGSL source for the body of `@compute fn main()`, writing into `out.values[i]`. */
  readonly computeBody: string;
}

const hashModulePath = resolve("packages/wgsl-std/src/hash/index.wgsl");
const gradientModulePath = resolve("packages/wgsl-std/src/noise/internal/gradient.wgsl");

export async function runNoiseCompute(args: RunNoiseComputeArgs): Promise<Float32Array> {
  const outputSize = args.outputLength * Float32Array.BYTES_PER_ELEMENT;
  const entrySource = `import { ${args.imports.join(", ")} } from "${args.packageSubpath}";
struct Out { values: array<f32, ${args.outputLength}> }
@group(0) @binding(0) var<storage, read_write> out: Out;
@compute @workgroup_size(1)
fn main() {
${args.computeBody}
}`;
  const modulePaths = [hashModulePath, gradientModulePath, args.modulePackagePath, ...args.extraModulePaths ?? []];
  const modules: Record<string, string> = { "/main.wgsl": entrySource };
  for (const path of modulePaths) modules[path] = await readFile(path, "utf8");
  const shader = await resolveShader({
    entry: "/main.wgsl",
    modules,
    packageMap: packageMapOf({ "@vgpu/wgsl-std/hash": hashModulePath, ...args.extraPackageMap, [args.packageSubpath]: args.modulePackagePath }),
    validate: false,
  });

  const device = await createNodeAdapter().requestDevice();
  const gpu = device.gpu;
  const output = gpu.createBuffer({ size: outputSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
  const readback = gpu.createBuffer({ size: outputSize, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
  try {
    const pipeline = gpu.createComputePipeline({ layout: "auto", compute: { module: gpu.createShaderModule({ code: shader.wgsl }), entryPoint: "main" } });
    const bindGroup = gpu.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: output } }] });
    const encoder = gpu.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, outputSize);
    gpu.queue.submit([encoder.finish()]);
    await gpu.queue.onSubmittedWorkDone();
    await readback.mapAsync(GPUMapMode.READ);
    return new Float32Array(new Uint8Array(readback.getMappedRange()).slice().buffer);
  } finally {
    if (readback.mapState === "mapped") readback.unmap();
    readback.destroy();
    output.destroy();
    device.destroy();
  }
}

/**
 * `resolveImport` prefix-matches `packageMap` entries in insertion order, so a shorter specifier
 * that happens to prefix a longer one would swallow it. Sorting longest-first makes the map
 * order-independent for callers.
 */
function packageMapOf(entries: Readonly<Record<string, string>>): Record<string, string> {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(entries).sort((left, right) => right.length - left.length)) sorted[key] = entries[key]!;
  return sorted;
}
