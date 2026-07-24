import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  init: vi.fn(),
}));
vi.mock('vgpu', () => ({ init: mocks.init }));

import { createRenderer } from './renderer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function browser() {
  const listeners = new Map<string, EventListener>();
  vi.stubGlobal('window', {
    devicePixelRatio: 1,
    addEventListener: vi.fn((name: string, listener: EventListener) => listeners.set(name, listener)),
    removeEventListener: vi.fn((name: string) => listeners.delete(name)),
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn();
    disconnect = disconnect;
  });
  const canvas = { getBoundingClientRect: () => ({ width: 100, height: 50 }) } as HTMLCanvasElement;
  return { canvas, listeners, disconnect };
}

function gpu() {
  const stop = vi.fn();
  const surface = { size: [100, 50], dispose: vi.fn() };
  const instance = {
    time: 0,
    surface: vi.fn(() => surface),
    effect: vi.fn(() => ({ set: vi.fn() })),
    frame: { loop: vi.fn(() => ({ stop })) },
    dispose: vi.fn(),
  };
  return { instance, surface, stop };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('dispose during init cleans a late GPU without starting a loop', async () => {
  const { canvas } = browser();
  const pending = deferred<ReturnType<typeof gpu>['instance']>();
  mocks.init.mockReturnValueOnce(pending.promise);
  const renderer = createRenderer({ canvas });
  await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce());
  renderer.dispose();
  renderer.dispose();
  const late = gpu();
  pending.resolve(late.instance);
  await renderer.ready;
  expect(late.instance.dispose).toHaveBeenCalledOnce();
  expect(late.instance.frame.loop).not.toHaveBeenCalled();
});

test('owns one loop and removes resize resources synchronously', async () => {
  const { canvas, listeners, disconnect } = browser();
  const live = gpu();
  mocks.init.mockResolvedValueOnce(live.instance);
  const renderer = createRenderer({ canvas });
  await renderer.ready;
  expect(live.instance.frame.loop).toHaveBeenCalledOnce();
  renderer.dispose();
  renderer.dispose();
  expect(live.stop).toHaveBeenCalledOnce();
  expect(live.surface.dispose).toHaveBeenCalledOnce();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(0);
});
