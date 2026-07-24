import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('vgpu', () => ({ init: mocks.init }));

import { createRenderer } from './renderer';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('dispose-before-ready destroys a late GPU and never starts the ocean graph', async () => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  const pending = deferred<{ dispose(): void; surface: ReturnType<typeof vi.fn>; frame: { loop: ReturnType<typeof vi.fn> } }>();
  mocks.init.mockReturnValueOnce(pending.promise);
  const canvas = { getBoundingClientRect: () => ({ width: 100, height: 50 }) } as HTMLCanvasElement;
  const renderer = createRenderer({ canvas });
  await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce());
  renderer.dispose();
  renderer.dispose();
  const gpu = { dispose: vi.fn(), surface: vi.fn(), frame: { loop: vi.fn() } };
  pending.resolve(gpu);
  await renderer.ready;
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(gpu.surface).not.toHaveBeenCalled();
  expect(gpu.frame.loop).not.toHaveBeenCalled();
});
