import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
  createFluid: vi.fn(() => ({ marker: 'fluid' })),
  prepareFluid: vi.fn(async () => {}),
  renderFluid: vi.fn(),
  stepFluid: vi.fn(),
  inputDispose: vi.fn(),
}));
vi.mock('vgpu', () => ({ init: mocks.init }));
vi.mock('./simulation', () => ({
  createFluid: mocks.createFluid,
  prepareFluid: mocks.prepareFluid,
  renderFluid: mocks.renderFluid,
  stepFluid: mocks.stepFluid,
}));
vi.mock('./pointer-input', () => ({ installStirInput: () => ({ dispose: mocks.inputDispose }) }));

import { createRenderer } from './renderer';

function setup() {
  let nextRaf = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    const id = nextRaf++;
    callbacks.set(id, callback);
    return id;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => callbacks.delete(id)));
  vi.stubGlobal('performance', { now: () => 0 });
  const page = { hidden: false };
  vi.stubGlobal('document', page);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const surface = { onResize: vi.fn(() => vi.fn()), dispose: vi.fn(), size: [100, 50], format: 'bgra8unorm' };
  const gpu = { surface: vi.fn(() => surface), dispose: vi.fn() };
  mocks.init.mockResolvedValueOnce(gpu);
  const canvas = {
    style: { touchAction: '' },
    getBoundingClientRect: () => ({ width: 100, height: 50 }),
  } as unknown as HTMLCanvasElement;
  const fireNext = (time: number) => {
    const entry = callbacks.entries().next().value as [number, FrameRequestCallback] | undefined;
    if (!entry) return;
    callbacks.delete(entry[0]);
    entry[1](time);
  };
  return { page, surface, gpu, canvas, callbacks, fireNext };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('hidden time is discarded by the fixed-step RAF and disposal cancels future work', async () => {
  const env = setup();
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  env.fireNext(17);
  expect(mocks.stepFluid).toHaveBeenCalledOnce();
  env.page.hidden = true;
  env.fireNext(10_000);
  expect(mocks.stepFluid).toHaveBeenCalledOnce();
  env.page.hidden = false;
  env.fireNext(10_017);
  expect(mocks.stepFluid).toHaveBeenCalledTimes(2);
  renderer.dispose();
  renderer.dispose();
  expect(env.callbacks.size).toBe(0);
  expect(mocks.inputDispose).toHaveBeenCalledOnce();
  expect(env.surface.dispose).toHaveBeenCalledOnce();
  expect(env.gpu.dispose).toHaveBeenCalledOnce();
});

test('dispose before GPU readiness prevents installation and disposes the late GPU', async () => {
  const env = setup();
  let resolve!: (gpu: typeof env.gpu) => void;
  mocks.init.mockReset().mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const renderer = createRenderer({ canvas: env.canvas });
  // Let the dynamic import settle so initialization is waiting on init().
  await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce());
  renderer.dispose();
  resolve(env.gpu);
  await renderer.ready;
  expect(env.gpu.dispose).toHaveBeenCalledOnce();
  expect(env.callbacks.size).toBe(0);
});
