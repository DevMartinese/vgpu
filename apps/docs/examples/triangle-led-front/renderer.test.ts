import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ init: vi.fn(), createHeroRenderer: vi.fn() }));
vi.mock('vgpu', () => ({ init: mocks.init }));
vi.mock('./scene-renderer', () => ({ createHeroRenderer: mocks.createHeroRenderer }));

import { Controls } from './controls';
import { createRenderer } from './renderer';
import { DEFAULT_TRIANGLE_LED_CONTROLS } from './types';

function setup() {
  const canvasListeners = new Map<string, EventListener>();
  const windowAdd = vi.fn();
  const windowRemove = vi.fn();
  const documentAdd = vi.fn();
  vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: windowAdd, removeEventListener: windowRemove });
  vi.stubGlobal('document', { addEventListener: documentAdd, removeEventListener: vi.fn() });
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
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
  return { canvas, canvasListeners, windowAdd, documentAdd, disconnect, gpu, surface, scene, stop };
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
