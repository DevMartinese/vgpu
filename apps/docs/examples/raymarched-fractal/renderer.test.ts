import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ init: vi.fn() }));
vi.mock('vgpu', () => ({ init: mocks.init }));

import { createRenderer } from './renderer';

const canvas = {
  style: { touchAction: '' },
  getBoundingClientRect: () => ({ width: 100, height: 50 }),
  addEventListener: vi.fn(), removeEventListener: vi.fn(),
} as unknown as HTMLCanvasElement;

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('dispose before readiness is idempotent and destroys a GPU that resolves late', async () => {
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const gpu = { dispose: vi.fn() };
  let resolve!: (value: typeof gpu) => void;
  mocks.init.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const renderer = createRenderer({ canvas });
  await vi.waitFor(() => expect(mocks.init).toHaveBeenCalledOnce());
  renderer.dispose();
  renderer.dispose();
  resolve(gpu);
  await renderer.ready;
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(requestAnimationFrame).not.toHaveBeenCalled();
});
