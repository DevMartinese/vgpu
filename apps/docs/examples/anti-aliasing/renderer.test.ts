import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ init: vi.fn() })); vi.mock('vgpu', () => ({ init: mocks.init }));
import { Controls } from './controls'; import { createRenderer } from './renderer'; import { AA_MODE_FXAA, AA_MODE_OFF, DEFAULT_ANTI_ALIASING_CONTROLS } from './types';
function setup() {
 vi.stubGlobal('window', { devicePixelRatio: 1, addEventListener: vi.fn(), removeEventListener: vi.fn() }); vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1)); vi.stubGlobal('cancelAnimationFrame', vi.fn()); const disconnect=vi.fn(); vi.stubGlobal('ResizeObserver', class { observe=vi.fn(); disconnect=disconnect; });
 const set=vi.fn(), compile=vi.fn(async()=>{}), stop=vi.fn(), buffer={ gpu:{ destroy:vi.fn() }, write:vi.fn() }; const target=()=>({size:[100,50],format:'rgba8unorm',resize:vi.fn(),destroy:vi.fn()}); const surface={size:[100,50],format:'bgra8unorm',dispose:vi.fn()};
 const gpu={time:0,surface:vi.fn(()=>surface),target:vi.fn(target),device:{createBuffer:vi.fn(()=>buffer)},draw:vi.fn(()=>({set,compile})),effect:vi.fn(()=>({set,compile})),sampler:vi.fn(()=>({})),frame:{loop:vi.fn(()=>({stop}))},dispose:vi.fn()}; mocks.init.mockResolvedValueOnce(gpu); const canvas={getBoundingClientRect:()=>({width:100,height:50})} as HTMLCanvasElement; return {canvas,gpu,set,stop,surface,disconnect};
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
test('shares the FXAA default with the accessible controlled select',()=>{const html=renderToStaticMarkup(createElement(Controls, { value: DEFAULT_ANTI_ALIASING_CONTROLS, onChange: () => {} }));expect(DEFAULT_ANTI_ALIASING_CONTROLS.mode).toBe(AA_MODE_FXAA);expect(html).toContain('aria-label="Anti-aliasing mode"');expect(html).toContain('value="3" selected');});
test('updates mode without recreating and disposes idempotently',async()=>{const e=setup();const r=createRenderer({canvas:e.canvas});await r.ready;const before=e.gpu.draw.mock.calls.length;r.setControls?.({mode:AA_MODE_OFF});r.setControls?.({mode:AA_MODE_OFF});expect(e.gpu.draw.mock.calls.length).toBe(before);r.dispose();r.dispose();expect(e.stop).toHaveBeenCalledOnce();expect(e.surface.dispose).toHaveBeenCalledOnce();expect(e.disconnect).toHaveBeenCalledOnce();});
