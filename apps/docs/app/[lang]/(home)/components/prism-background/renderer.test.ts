/**
 * Renderer lifecycle, against a mocked `vgpu`. This is the half of the example
 * that has nothing to do with optics: one frame loop, one mutable light buffer,
 * coalesced resizes, and a teardown that releases everything even when
 * initialization loses a race with `dispose()`.
 *
 * The physics is covered by `optics.test.ts` and, on a real device, by
 * `examples/prism-validation`.
 */

import { afterEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ init: vi.fn() }));
const vgpuFns = vi.hoisted(() =>
  Object.fromEntries(
    [
      "surface",
      "target",
      "effect",
      "draw",
      "geometry",
      "sampler",
      "bundle",
      "compute",
      "storage",
      "uniforms",
      "timer",
      "visibility",
      "frame",
      "frameLoop",
    ]
      // Each test's gpu double carries its factory fakes in `fns`; these route the free functions to them.
      .map((name) => [
        name,
        (gpu: any, ...args: any[]) => gpu.fns[name](...args),
      ])
  )
) as Record<string, unknown>;
vi.mock("vgpu", () => ({
  init: mocks.init,
  ...vgpuFns,
  clock: (gpu: any) =>
    gpu.clock ?? { time: 0, deltaTime: 0, frameCount: 0, advance() {} },
}));

import { createRenderer } from "./renderer";
import {
  LIGHT_INTERNAL_FIRST_VERTEX,
  LIGHT_INTERNAL_VERTICES,
  LIGHT_OUTGOING_FIRST_VERTEX,
  LIGHT_OUTGOING_VERTICES,
  LIGHT_WHITE_VERTICES,
} from "./light-mesh";
import { wallExtent } from "./scene";
import {
  CAMERA_DISTANCE,
  DEFAULT_PRISM_CONTROLS,
  PRISM_DEFAULT_ARC,
  PRISM_LIGHT_PLANE_Z,
} from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function partialDraw(pipeline: unknown, firstVertex: number, vertices: number) {
  return { pipeline, options: { firstVertex, vertices } };
}

function browser() {
  const windowListeners = new Map<string, EventListener>();
  const canvasListeners = new Map<string, EventListener>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("window", {
    devicePixelRatio: 2,
    addEventListener: vi.fn((name: string, listener: EventListener) =>
      windowListeners.set(name, listener)
    ),
    removeEventListener: vi.fn((name: string) => windowListeners.delete(name)),
  });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    })
  );
  vi.stubGlobal(
    "cancelAnimationFrame",
    vi.fn((id: number) => frames.delete(id))
  );
  const disconnect = vi.fn();
  const observe = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe = observe;
      disconnect = disconnect;
    }
  );

  const captured = new Set<number>();
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    addEventListener: vi.fn((name: string, listener: EventListener) =>
      canvasListeners.set(name, listener)
    ),
    removeEventListener: vi.fn((name: string) => canvasListeners.delete(name)),
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: vi.fn((id: number) => captured.has(id)),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  } as unknown as HTMLCanvasElement;
  const framingElement = {
    getBoundingClientRect: () => ({
      left: 100,
      top: 10,
      width: 90,
      height: 80,
    }),
  } as unknown as HTMLElement;
  return {
    canvas,
    framingElement,
    canvasListeners,
    windowListeners,
    frames,
    observe,
    disconnect,
  };
}

function gpu() {
  const stop = vi.fn();
  const gpuClock = {
    time: 0,
    deltaTime: 0,
    frameCount: 0,
    advance: vi.fn(),
  };
  const encodedPasses: unknown[][] = [];
  const passOptions: unknown[] = [];
  const loopFrame = {
    pass: vi.fn((options: unknown, body: (pass: unknown) => void) => {
      passOptions.push(options);
      const encoded: unknown[] = [];
      body({
        draw: (pipeline: unknown, options?: unknown) =>
          encoded.push(options ? { pipeline, options } : pipeline),
      });
      encodedPasses.push(encoded);
    }),
  };
  const surface = {
    size: [200, 100] as number[],
    format: "bgra8unorm",
    // Mirrors the real surface: a resize changes the size the scene is sized from.
    resize: vi.fn((size: number[]) => {
      surface.size = size;
    }),
    dispose: vi.fn(),
  };
  const lightBuffer = {
    gpu: { destroy: vi.fn() },
    write: vi.fn(),
    destroy: vi.fn(),
  };
  const effects: {
    set: ReturnType<typeof vi.fn>;
    compile: ReturnType<typeof vi.fn>;
  }[] = [];
  const draws: {
    set: ReturnType<typeof vi.fn>;
    compile: ReturnType<typeof vi.fn>;
  }[] = [];
  const targets: {
    size: number[];
    format: string;
    color: { gpu: object };
    msaa?: boolean | 4;
    resize: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  const textures: {
    gpu: object;
    label?: string;
    options: Record<string, unknown>;
    destroy: ReturnType<typeof vi.fn>;
  }[] = [];
  const copyTextureToTexture = vi.fn();
  const finishEncoder = vi.fn(() => ({}));
  const pipeline = (
    into: { set: ReturnType<typeof vi.fn>; compile: ReturnType<typeof vi.fn> }[]
  ) => {
    const created = { set: vi.fn(), compile: vi.fn(async () => {}) };
    into.push(created);
    return created;
  };
  const instance = {
    clock: gpuClock,
    gpu: {
      queue: {
        onSubmittedWorkDone: vi.fn(async () => {}),
        submit: vi.fn(),
      },
      createCommandEncoder: vi.fn(() => ({
        copyTextureToTexture,
        finish: finishEncoder,
      })),
    },
    device: {
      createBuffer: vi.fn(() => lightBuffer),
      createTexture: vi.fn((options: Record<string, unknown>) => {
        const created = {
          gpu: {},
          label: options.label as string | undefined,
          options,
          destroy: vi.fn(),
        };
        textures.push(created);
        return created;
      }),
    },
    settled: vi.fn(async () => {}),
    dispose: vi.fn(),
    fns: {
      surface: vi.fn(() => surface),
      sampler: vi.fn(() => ({})),
      geometry: vi.fn(() => ({ destroy: vi.fn() })),
      target: vi.fn(
        (options: { size: number[]; format?: string; msaa?: boolean | 4 }) => {
          const created = {
            size: [...options.size],
            format: options.format ?? "bgra8unorm",
            color: { gpu: {} },
            msaa: options.msaa,
            resize: vi.fn((size: number[]) => {
              created.size = [...size];
            }),
            destroy: vi.fn(),
          };
          targets.push(created);
          return created;
        }
      ),
      effect: vi.fn(() => pipeline(effects)),
      draw: vi.fn(() => pipeline(draws)),
      // The free functions are routed with `gpu` stripped, so these fakes see
      // only the arguments after it.
      frame: vi.fn((callback: (frame: unknown) => void) =>
        callback({
          pass: (_options: unknown, body: (pass: unknown) => void) =>
            body({ draw: vi.fn() }),
        })
      ),
      frameLoop: vi.fn((_tick: (_frame: unknown) => void) => ({ stop })),
    },
  };
  return {
    instance,
    surface,
    lightBuffer,
    effects,
    draws,
    targets,
    textures,
    copyTextureToTexture,
    loopFrame,
    encodedPasses,
    passOptions,
    gpuClock,
    stop,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("renders the deterministic light once and idles until something changes", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;

  expect(live.instance.fns.frameLoop).toHaveBeenCalledOnce();
  // The light mesh is written once at construction and once after the final
  // output aspect is known. No history textures are allocated.
  expect(live.instance.device.createBuffer).toHaveBeenCalledOnce();
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(2);
  expect(live.effects).toHaveLength(13);
  expect(live.draws).toHaveLength(7);
  expect(live.instance.fns.draw).toHaveBeenNthCalledWith(
    3,
    expect.objectContaining({ blend: "premultiplied" })
  );
  expect(live.instance.fns.draw).toHaveBeenNthCalledWith(
    7,
    expect.objectContaining({
      vertices: 6,
      instances: 6000,
      depth: false,
      blend: "additive",
    })
  );
  expect(live.instance.fns.sampler).toHaveBeenNthCalledWith(2, {
    minFilter: "linear",
    magFilter: "linear",
    mipmapFilter: "linear",
    addressModeU: "repeat",
    addressModeV: "clamp-to-edge",
  });
  for (const created of [...live.effects, ...live.draws])
    expect(created.compile).toHaveBeenCalledOnce();
  // Canvas surfaces do not expose a current texture until a frame begins, so
  // output pipelines must pre-warm from the surface's stable format signature.
  expect(live.effects[8]!.compile).toHaveBeenCalledWith({
    colors: ["bgra8unorm"],
  });
  // One full-resolution MSAA target composites back-side glass and light; a
  // second lets the front interface sample that resolved result. Four smaller
  // HDR targets hold bloom, and the remainder are transient mip-bake surfaces.
  expect(live.targets).toHaveLength(36);
  expect(live.targets[0]!.format).toBe("rgba16float");
  expect(live.targets[1]!.format).toBe("rgba16float");
  expect(live.targets[0]!.msaa).toBe(true);
  expect(live.targets[1]!.msaa).toBe(true);
  expect(live.targets.slice(2, 6).map((entry) => entry.size)).toEqual([
    [100, 50],
    [50, 25],
    [25, 13],
    [13, 7],
  ]);
  for (const bloomTarget of live.targets.slice(2, 6)) {
    expect(bloomTarget.format).toBe("rgba16float");
    expect(bloomTarget.msaa).toBeUndefined();
  }
  expect(live.textures).toHaveLength(2);
  for (const environmentTexture of live.textures) {
    expect(environmentTexture.options).toEqual(
      expect.objectContaining({
        size: [2048, 1024],
        format: "rgba16float",
        mipLevelCount: 8,
        usage: ["texture_binding", "copy_dst"],
      })
    );
  }
  expect(live.effects[9]!.compile).toHaveBeenCalledWith(live.targets[6]);
  expect(live.effects[10]!.compile).toHaveBeenCalledWith(live.targets[6]);
  expect(live.effects[11]!.compile).toHaveBeenCalledWith(live.targets[7]);
  expect(live.effects[12]!.compile).toHaveBeenCalledWith(live.targets[7]);
  expect(live.effects[9]!.set).toHaveBeenCalledWith({
    params: { debug: 0 },
  });
  expect(live.effects[11]!.set).toHaveBeenCalledWith({
    params: { debug: 1 },
  });
  expect(live.copyTextureToTexture).toHaveBeenCalledTimes(16);
  expect(live.effects[0]!.compile).toHaveBeenCalledWith(live.targets[1]);
  for (let level = 0; level < 4; level++) {
    expect(live.effects[level + 1]!.compile).toHaveBeenCalledWith(
      live.targets[level + 2]
    );
  }
  for (let index = 0; index < 3; index++) {
    expect(live.effects[index + 5]!.compile).toHaveBeenCalledWith(
      live.targets[4 - index]
    );
  }
  expect(live.draws[0]!.compile).toHaveBeenCalledWith(live.targets[0]);
  expect(live.draws[1]!.compile).toHaveBeenCalledWith(live.targets[0]);
  expect(live.draws[2]!.compile).toHaveBeenCalledWith(live.targets[0]);
  expect(live.draws[3]!.compile).toHaveBeenCalledWith(live.targets[1]);
  expect(live.draws[4]!.compile).toHaveBeenCalledWith(live.targets[1]);
  expect(live.draws[5]!.compile).toHaveBeenCalledWith(live.targets[0]);
  expect(live.draws[6]!.compile).toHaveBeenCalledWith({
    colors: ["bgra8unorm"],
  });
  expect(live.effects[0]!.set).toHaveBeenLastCalledWith({
    sceneTexture: live.targets[0],
  });
  expect(live.draws[2]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      studioEnvironment: live.textures[0],
      debugEnvironment: live.textures[1],
    })
  );
  expect(live.draws[3]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sceneTexture: live.targets[0],
      studioEnvironment: live.textures[0],
      debugEnvironment: live.textures[1],
    })
  );
  const backGlassBindings = live.draws[2]!.set.mock.lastCall?.[0];
  const frontGlassBindings = live.draws[3]!.set.mock.lastCall?.[0];
  expect(backGlassBindings).not.toHaveProperty("sceneTexture");
  expect(backGlassBindings).not.toHaveProperty("sceneSampler");
  expect(frontGlassBindings).toEqual(
    expect.objectContaining({ sceneTexture: live.targets[0] })
  );
  expect(frontGlassBindings).toHaveProperty("sceneSampler");
  expect(live.effects[1]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceTexture: live.targets[1] })
  );
  expect(live.effects[2]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceTexture: live.targets[2] })
  );
  expect(live.effects[5]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceTexture: live.targets[5] })
  );
  expect(live.effects[6]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceTexture: live.targets[4] })
  );
  expect(live.effects[7]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({ sourceTexture: live.targets[3] })
  );
  expect(live.effects[8]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      sceneTexture: live.targets[1],
      bloomTexture: live.targets[2],
    })
  );
  expect(live.draws[0]!.set).toHaveBeenLastCalledWith({
    scene: expect.objectContaining({ lightPlaneZ: PRISM_LIGHT_PLANE_Z }),
  });
  expect(live.draws[6]!.set).toHaveBeenLastCalledWith({
    params: expect.objectContaining({
      outputSize: [200, 100],
      time: 0,
      lightPlaneZ: PRISM_LIGHT_PLANE_Z,
      exposure: 1,
    }),
    lightTexture: live.targets[2],
    lightSampler: expect.anything(),
  });

  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];
  tick(live.loopFrame);
  // Thirty standalone passes bake both eight-level pyramids once. Runtime
  // rendering encodes the sorted background, refractive front, seven bloom
  // passes and present.
  expect(live.instance.fns.frame).toHaveBeenCalledTimes(30);
  expect(live.loopFrame.pass).toHaveBeenCalledTimes(10);
  expect(live.encodedPasses).toEqual([
    [
      live.draws[1],
      partialDraw(live.draws[0], 0, LIGHT_WHITE_VERTICES),
      partialDraw(
        live.draws[0],
        LIGHT_OUTGOING_FIRST_VERTEX,
        LIGHT_OUTGOING_VERTICES
      ),
      live.draws[2],
      partialDraw(
        live.draws[0],
        LIGHT_INTERNAL_FIRST_VERTEX,
        LIGHT_INTERNAL_VERTICES
      ),
    ],
    [live.effects[0], live.draws[3]],
    [live.effects[1]],
    [live.effects[2]],
    [live.effects[3]],
    [live.effects[4]],
    [live.effects[5]],
    [live.effects[6]],
    [live.effects[7]],
    [live.effects[8], live.draws[6]],
  ]);
  for (const options of live.passOptions.slice(6, 9)) {
    expect(options).toEqual(expect.objectContaining({ clear: false }));
  }
  tick(live.loopFrame);
  expect(live.loopFrame.pass).toHaveBeenCalledTimes(10);
  renderer.dispose();
});

test("dust-only animation frames reuse the resolved scene and bloom", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];

  tick(live.loopFrame);
  expect(live.loopFrame.pass).toHaveBeenCalledTimes(10);

  live.gpuClock.time = 1 / 30;
  tick(live.loopFrame);

  expect(live.loopFrame.pass).toHaveBeenCalledTimes(11);
  expect(live.encodedPasses.at(-1)).toEqual([live.effects[8], live.draws[6]]);
  expect(live.draws[6]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({ time: 1 / 30 }),
    })
  );
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(2);
  renderer.dispose();
});

test("the back-face view keeps the sorted light around the environment-only glass", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];

  renderer.setControls?.({ ...DEFAULT_PRISM_CONTROLS, view: "back" });
  tick(live.loopFrame);

  expect(live.encodedPasses).toEqual([
    [
      live.draws[1],
      partialDraw(live.draws[0], 0, LIGHT_WHITE_VERTICES),
      partialDraw(
        live.draws[0],
        LIGHT_OUTGOING_FIRST_VERTEX,
        LIGHT_OUTGOING_VERTICES
      ),
      live.draws[2],
      partialDraw(
        live.draws[0],
        LIGHT_INTERNAL_FIRST_VERTEX,
        LIGHT_INTERNAL_VERTICES
      ),
    ],
    [live.effects[0]],
    [live.effects[1]],
    [live.effects[2]],
    [live.effects[3]],
    [live.effects[4]],
    [live.effects[5]],
    [live.effects[6]],
    [live.effects[7]],
    [live.effects[8]],
  ]);
  renderer.dispose();
});

test("the light wireframe reveals every generated triangle in the light-only view", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];

  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    view: "caustic",
    lightWireframe: true,
  });
  tick(live.loopFrame);

  expect(live.encodedPasses[0]).toEqual([
    live.draws[1],
    partialDraw(live.draws[0], 0, LIGHT_WHITE_VERTICES),
    partialDraw(
      live.draws[0],
      LIGHT_OUTGOING_FIRST_VERTEX,
      LIGHT_OUTGOING_VERTICES
    ),
    partialDraw(live.draws[5], 0, LIGHT_WHITE_VERTICES),
    partialDraw(
      live.draws[5],
      LIGHT_OUTGOING_FIRST_VERTEX,
      LIGHT_OUTGOING_VERTICES
    ),
    partialDraw(
      live.draws[0],
      LIGHT_INTERNAL_FIRST_VERTEX,
      LIGHT_INTERNAL_VERTICES
    ),
    partialDraw(
      live.draws[5],
      LIGHT_INTERNAL_FIRST_VERTEX,
      LIGHT_INTERNAL_VERTICES
    ),
  ]);
  expect(live.draws[5]!.set).toHaveBeenLastCalledWith({
    scene: expect.objectContaining({ lightPlaneZ: PRISM_LIGHT_PLANE_Z }),
  });
  renderer.dispose();
});

test("pointer position smoothly moves the lamp and its target without dragging", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];
  const writesBeforeMove = live.lightBuffer.write.mock.calls.length;

  env.windowListeners.get("pointermove")?.({
    pointerId: 4,
    clientX: 20,
    clientY: 10,
  } as unknown as Event);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writesBeforeMove);
  tick(live.loopFrame);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writesBeforeMove + 1);
  tick(live.loopFrame);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writesBeforeMove + 2);

  env.windowListeners.get("pointermove")?.({
    pointerId: 9,
    clientX: 180,
    clientY: 90,
  } as unknown as Event);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writesBeforeMove + 2);
  tick(live.loopFrame);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writesBeforeMove + 3);
  expect(env.canvas.setPointerCapture).not.toHaveBeenCalled();
  renderer.dispose();
});

test("only optical controls rebuild the light mesh", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];
  const writes = live.lightBuffer.write.mock.calls.length;

  // Peeling a layer off only changes how the same mesh is composited.
  renderer.setControls?.({ ...DEFAULT_PRISM_CONTROLS, view: "caustic" });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes);
  // Wall paint changes the composite, not the optical path.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    view: "caustic",
    wallColor: "#101216",
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes);
  // Wireframe only adds an overlay draw over the already-generated prism.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    view: "glass",
    wireframe: true,
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes);
  // The diagnostic environment changes glass uniforms, but cannot retrace light.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    environmentDebug: true,
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes);
  tick(live.loopFrame);
  expect(live.draws[2]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({ environmentDebug: 1 }),
    })
  );
  // Glass material sliders update uniforms without retracing the spectral mesh.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    glass: {
      ...DEFAULT_PRISM_CONTROLS.glass,
      ior: 1.72,
      absorption: [0.2, 0.15, 0.1],
    },
  });
  tick(live.loopFrame);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes);
  expect(live.draws[2]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({
        ior: 1.72,
        absorption: [0.2, 0.15, 0.1],
      }),
    })
  );
  // Bloom runs on the already-rendered HDR image; its controls only update
  // postprocess uniforms and leave the traced light mesh untouched.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    postprocess: {
      bloomStrength: 1.8,
      bloomThreshold: 0.4,
      bloomRadius: 4,
      particleExposure: 2.25,
    },
  });
  tick(live.loopFrame);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes);
  expect(live.effects[1]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({
        threshold: 0.4,
        extractHighlights: 1,
      }),
    })
  );
  expect(live.effects[8]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: { bloomStrength: 1.8 },
    })
  );
  expect(live.draws[6]!.set).toHaveBeenLastCalledWith(
    expect.objectContaining({
      params: expect.objectContaining({ exposure: 2.25 }),
    })
  );
  // A different index of refraction bends every ribbon differently.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    dispersion: "flint",
    view: "caustic",
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes + 1);
  // Changing the physical beam width retraces its boundary and profile rays.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    dispersion: "flint",
    view: "caustic",
    beamWidth: 0.14,
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes + 2);
  // Custom Cauchy coefficients let the debug GUI tune the optical material
  // without changing the visible prism geometry.
  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    spectralDispersion: { base: 1.3, strength: 0.025 },
    view: "caustic",
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes + 3);
  renderer.dispose();
});

test("fade controls rebuild only the data that cannot stay in the shader", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];
  const writes = live.lightBuffer.write.mock.calls.length;

  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    lightFade: {
      beamOpacity: 0.35,
      edgeFalloff: 10,
      rainbowFalloff: 3.2,
    },
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes + 1);

  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    lightFade: {
      beamOpacity: 0.35,
      edgeFalloff: 10,
      rainbowFalloff: 5.5,
    },
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes + 1);
  tick(live.loopFrame);
  expect(live.draws[0]!.set).toHaveBeenLastCalledWith({
    scene: expect.objectContaining({
      lightEdgeFalloff: 10,
      rainbowFalloff: 5.5,
      lightOpacity: 0.35,
    }),
  });
  renderer.dispose();
});

test("FOV updates the automatically distanced camera boundary", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];
  const writes = live.lightBuffer.write.mock.calls.length;
  const cameraFov = 56;

  renderer.setControls?.({
    ...DEFAULT_PRISM_CONTROLS,
    cameraFov,
  });
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes + 1);
  tick(live.loopFrame);
  expect(live.draws[1]!.set).toHaveBeenLastCalledWith({
    scene: expect.objectContaining({
      wallHalfExtent: wallExtent(2, CAMERA_DISTANCE, cameraFov),
    }),
  });
  renderer.dispose();
});

test("observes and frames the prism relative to its canvas-local DOM slot", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({
    canvas: env.canvas,
    framingElement: env.framingElement,
  });
  await renderer.ready;

  expect(env.observe).toHaveBeenCalledWith(env.canvas);
  expect(env.observe).toHaveBeenCalledWith(env.framingElement);
  expect(env.frames.size).toBe(1);
  [...env.frames.values()][0]?.(16);

  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];
  tick(live.loopFrame);
  const uniforms = live.draws[1]!.set.mock.lastCall?.[0] as {
    scene: { viewProjection: Float32Array };
  };
  const matrix = uniforms.scene.viewProjection;
  // A canvas-local slot on the right produces an off-axis projection, while
  // the exact silhouette containment is covered by framing.test.ts.
  expect(matrix[12]! / matrix[15]!).toBeGreaterThan(0);
  expect(Number.isFinite(matrix[13]! / matrix[15]!)).toBe(true);

  renderer.dispose();
});

test("the camera follows the pointer without rebuilding an unchanged light", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  const tick = live.instance.fns.frameLoop.mock.calls[0]![0];
  const pointer = {
    pointerId: 7,
    clientX: 100,
    clientY: PRISM_DEFAULT_ARC * 100,
  } as unknown as Event;

  env.windowListeners.get("pointermove")?.(pointer);
  const writes = live.lightBuffer.write.mock.calls.length;
  tick(live.loopFrame);
  // Repeating the same pointer coordinate continues the camera easing without
  // regenerating the already-current world-space light mesh.
  env.windowListeners.get("pointermove")?.(pointer);
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(writes);
  expect(live.loopFrame.pass).toHaveBeenCalledTimes(10);
  renderer.dispose();
});

test("coalesces resizes and updates both scene targets plus the light mesh", async () => {
  const env = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;

  renderer.resize({ width: 300, height: 150, dpr: 1.6 });
  renderer.resize({ width: 900, height: 500, dpr: 2 });
  // Two requests, one animation frame: the last size wins.
  expect(env.frames.size).toBe(1);
  [...env.frames.values()][0]?.(16);
  expect(live.surface.resize).toHaveBeenCalledOnce();
  expect(live.surface.resize).toHaveBeenCalledWith([1800, 1000]);

  expect(live.targets[0]!.resize).toHaveBeenCalledWith([1800, 1000]);
  expect(live.targets[1]!.resize).toHaveBeenCalledWith([1800, 1000]);
  const bloomSizes = [
    [900, 500],
    [450, 250],
    [225, 125],
    [113, 63],
  ];
  live.targets.slice(2, 6).forEach((colorTarget, level) => {
    expect(colorTarget.resize).toHaveBeenCalledWith(bloomSizes[level]);
  });
  for (const transientTarget of live.targets.slice(6)) {
    expect(transientTarget.resize).not.toHaveBeenCalled();
    expect(transientTarget.destroy).toHaveBeenCalledOnce();
  }
  for (const colorTarget of live.targets.slice(0, 6))
    expect(colorTarget.destroy).not.toHaveBeenCalled();
  expect(live.lightBuffer.write).toHaveBeenCalledTimes(3);

  renderer.dispose();
  renderer.dispose();
  expect(live.stop).toHaveBeenCalledOnce();
  expect(env.disconnect).toHaveBeenCalledOnce();
  expect(live.surface.dispose).toHaveBeenCalledOnce();
  expect(live.instance.dispose).toHaveBeenCalledOnce();
  expect(env.canvasListeners.size).toBe(0);
  expect(env.windowListeners.size).toBe(0);
  expect(live.lightBuffer.destroy).toHaveBeenCalledOnce();
  for (const colorTarget of live.targets)
    expect(colorTarget.destroy).toHaveBeenCalledOnce();
  for (const environmentTexture of live.textures)
    expect(environmentTexture.destroy).toHaveBeenCalledOnce();
});

test("dispose during init cleans up a late GPU without starting a loop", async () => {
  const env = browser();
  const pending = deferred<ReturnType<typeof gpu>["instance"]>();
  mocks.init.mockReturnValueOnce(pending.promise);
  const renderer = createRenderer({ canvas: env.canvas });
  await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce());
  renderer.dispose();
  const late = gpu();
  pending.resolve(late.instance);
  await renderer.ready;
  expect(late.instance.dispose).toHaveBeenCalledOnce();
  expect(late.instance.fns.frameLoop).not.toHaveBeenCalled();
});

test("reports an initialization failure once, rejects ready, and self-disposes", async () => {
  const env = browser();
  const failed = gpu();
  const error = new Error("surface failed");
  failed.instance.fns.surface.mockImplementationOnce(() => {
    throw error;
  });
  mocks.init.mockResolvedValueOnce(failed.instance);
  const onError = vi.fn(() => {
    throw new Error("reporter failed");
  });
  const renderer = createRenderer({ canvas: env.canvas, onError });
  await expect(renderer.ready).rejects.toBe(error);
  expect(onError).toHaveBeenCalledOnce();
  expect(failed.instance.dispose).toHaveBeenCalledOnce();
  renderer.dispose();
  expect(failed.instance.dispose).toHaveBeenCalledOnce();
});
