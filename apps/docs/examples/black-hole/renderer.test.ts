import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('vgpu', () => ({ init: mocks.init }));

import { createRenderer } from './renderer';

function setup() {
  const windowListeners = new Map<string, EventListener>();
  const canvasListeners = new Map<string, EventListener>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('window', {
    devicePixelRatio: 2,
    addEventListener: vi.fn((name: string, listener: EventListener) => windowListeners.set(name, listener)),
    removeEventListener: vi.fn((name: string) => windowListeners.delete(name)),
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = disconnect; });

  const captured = new Set<number>();
  const canvas = {
    style: { touchAction: 'pan-y' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    addEventListener: vi.fn((name: string, listener: EventListener) => canvasListeners.set(name, listener)),
    removeEventListener: vi.fn((name: string) => canvasListeners.delete(name)),
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: vi.fn((id: number) => captured.has(id)),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  } as unknown as HTMLCanvasElement;

  const resize = vi.fn();
  const targets = Array.from({ length: 3 }, () => ({ size: [200, 100], texelSize: [1 / 200, 1 / 100], resize, format: 'rgba16float', read: vi.fn() }));
  const surface = { size: [200, 100], format: 'bgra8unorm', dispose: vi.fn() };
  const effect = () => ({ set: vi.fn(), compile: vi.fn(async () => {}) });
  const stop = vi.fn();
  const gpu = {
    time: 0,
    surface: vi.fn(() => surface),
    target: vi.fn(() => targets.shift()!),
    effect: vi.fn(effect),
    sampler: vi.fn(() => ({})),
    frame: Object.assign(vi.fn(), { loop: vi.fn(() => ({ stop })) }),
    dispose: vi.fn(),
  };
  mocks.init.mockResolvedValueOnce(gpu);
  return { canvas, canvasListeners, windowListeners, frames, disconnect, resize, surface, gpu, stop };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('coalesces resize work and cleans loop, observer, and pointer capture', async () => {
  const env = setup();
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  expect(env.gpu.frame.loop).toHaveBeenCalledOnce();
  expect(env.canvasListeners.has('pointermove')).toBe(true);

  env.canvasListeners.get('pointerdown')?.({ isPrimary: true, pointerId: 7 } as unknown as Event);
  expect(env.canvas.setPointerCapture).toHaveBeenCalledWith(7);
  renderer.resize({ width: 300, height: 150, dpr: 1.6 });
  renderer.resize({ width: 400, height: 200, dpr: 1.6 });
  expect(env.frames.size).toBe(1);
  [...env.frames.values()][0]?.(16);
  expect(env.resize).toHaveBeenCalledTimes(3);
  expect(env.resize).toHaveBeenLastCalledWith([640, 320]);

  renderer.dispose();
  renderer.dispose();
  expect(env.stop).toHaveBeenCalledOnce();
  expect(env.disconnect).toHaveBeenCalledOnce();
  expect(env.canvas.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(env.canvas.style.touchAction).toBe('pan-y');
  expect(env.canvasListeners.size).toBe(0);
  expect(env.windowListeners.size).toBe(0);
  expect(env.surface.dispose).toHaveBeenCalledOnce();
});
