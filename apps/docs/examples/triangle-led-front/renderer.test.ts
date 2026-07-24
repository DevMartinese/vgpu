import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ init: vi.fn(), createHeroRenderer: vi.fn() }));
vi.mock('vgpu', () => ({ init: mocks.init }));
vi.mock('./scene-renderer', () => ({ createHeroRenderer: mocks.createHeroRenderer }));

import { Controls } from './controls';
import { createRenderer } from './renderer';
import { DEFAULT_TRIANGLE_LED_CONTROLS } from './types';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup() {
  const canvasListeners = new Map<string, EventListener>();
  const windowAdd = vi.fn();
  const windowRemove = vi.fn();
  const documentAdd = vi.fn();
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: windowAdd, removeEventListener: windowRemove });
  vi.stubGlobal('document', { addEventListener: documentAdd, removeEventListener: vi.fn() });
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = disconnect; });
  const captured = new Set<number>();
  const canvas = {
    width: 200,
    height: 100,
    clientWidth: 200,
    clientHeight: 100,
    style: { touchAction: 'pan-y' },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 100 }),
    addEventListener: vi.fn((name: string, listener: EventListener) => canvasListeners.set(name, listener)),
    removeEventListener: vi.fn((name: string) => canvasListeners.delete(name)),
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: vi.fn((id: number) => captured.has(id)),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  } as unknown as HTMLCanvasElement;
  const stop = vi.fn();
  const surface = { dpr: 1, size: [200, 100], format: 'bgra8unorm', dispose: vi.fn() };
  const gpu = { time: 0, deltaTime: 1 / 60, surface: vi.fn(() => surface), frame: { loop: vi.fn(() => ({ stop })) }, dispose: vi.fn() };
  const scene = {
    setOutputTarget: vi.fn(), setHero: vi.fn(), prewarm: vi.fn(async () => {}), setBrush: vi.fn(),
    setRgbDeployActive: vi.fn(), renderFrame: vi.fn(), rebuild: vi.fn(), destroy: vi.fn(), hero: {},
  };
  mocks.init.mockResolvedValueOnce(gpu);
  mocks.createHeroRenderer.mockReturnValueOnce(scene);
  return { canvas, canvasListeners, frames, windowAdd, documentAdd, disconnect, gpu, surface, scene, stop };
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

test('uses the shared default in an accessible controlled select', () => {
  const html = renderToStaticMarkup(createElement(Controls, { value: DEFAULT_TRIANGLE_LED_CONTROLS, onChange: () => {} }));
  expect(DEFAULT_TRIANGLE_LED_CONTROLS.mode).toBe(-1);
  expect(html).toContain('aria-label="Triangle LED mode"');
  expect(html).toContain('value="-1" selected');
});

test('keeps pointer input canvas-scoped, updates controls without recreation, and cleans up', async () => {
  const env = setup();
  const renderer = createRenderer({ canvas: env.canvas });
  await renderer.ready;
  expect(env.documentAdd).not.toHaveBeenCalled();
  expect(env.windowAdd).toHaveBeenCalledTimes(1);
  expect(env.windowAdd).toHaveBeenCalledWith('resize', expect.any(Function));
  expect([...env.canvasListeners.keys()]).toEqual(['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave']);

  env.canvasListeners.get('pointerdown')?.({ isPrimary: true, pointerId: 7, clientX: 100, clientY: 50, pointerType: 'mouse' } as unknown as Event);
  expect(env.canvas.setPointerCapture).toHaveBeenCalledWith(7);
  renderer.setControls?.({ mode: 1 });
  expect(env.scene.setHero).toHaveBeenCalledTimes(2);
  expect(mocks.createHeroRenderer).toHaveBeenCalledOnce();

  renderer.dispose();
  renderer.dispose();
  expect(env.stop).toHaveBeenCalledOnce();
  expect(env.canvas.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(env.canvas.style.touchAction).toBe('pan-y');
  expect(env.canvasListeners.size).toBe(0);
  expect(env.disconnect).toHaveBeenCalledOnce();
  expect(env.scene.destroy).toHaveBeenCalledOnce();
  expect(env.surface.dispose).toHaveBeenCalledOnce();
});

test('silences stale resize failures and disposes on the current generation failure', async () => {
  const env = setup();
  const onError = vi.fn();
  const renderer = createRenderer({ canvas: env.canvas, onError });
  await renderer.ready;

  const runNextFrame = () => {
    const entry = env.frames.entries().next().value as [number, FrameRequestCallback] | undefined;
    expect(entry).toBeDefined();
    env.frames.delete(entry![0]);
    entry![1](16);
  };

  // Complete the initial measured resize before exercising overlapping generations.
  runNextFrame();
  await vi.waitFor(() => expect(env.scene.prewarm).toHaveBeenCalledTimes(2));

  const stale = deferred();
  const current = deferred();
  env.scene.prewarm.mockReturnValueOnce(stale.promise).mockReturnValueOnce(current.promise);

  renderer.resize({ width: 300, height: 150, dpr: 1 });
  runNextFrame();
  renderer.resize({ width: 400, height: 200, dpr: 1 });
  runNextFrame();

  stale.reject(new Error('stale resize failed'));
  await Promise.resolve();
  await Promise.resolve();
  expect(onError).not.toHaveBeenCalled();
  expect(env.scene.destroy).not.toHaveBeenCalled();

  const currentError = new Error('current resize failed');
  current.reject(currentError);
  await vi.waitFor(() => expect(env.scene.destroy).toHaveBeenCalledOnce());
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith(currentError);
  expect(env.stop).toHaveBeenCalledOnce();
  expect(env.surface.dispose).toHaveBeenCalledOnce();
  expect(env.gpu.dispose).toHaveBeenCalledOnce();
  await renderer.ready;
});
