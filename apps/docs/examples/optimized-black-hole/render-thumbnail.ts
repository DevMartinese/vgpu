import type { Gpu, Target } from "vgpu";
import * as vgpu from "vgpu";

import {
  createEffects,
  createTargets,
  destroyTargets,
  prewarm,
  renderChain,
  setBakeUniforms,
  setBindings,
  setPostUniforms,
  setShadeUniforms,
} from "./pipeline";
import { defaultHeroSettings } from "./settings";

interface ThumbnailOptions {
  warmupFrames?: number;
  time?: number;
  dt?: number;
}

export async function renderThumbnail(
  gpu: Gpu,
  output: Target,
  opts: ThumbnailOptions = {}
): Promise<void> {
  const settings = defaultHeroSettings();
  const effects = createEffects(vgpu, gpu);
  let targets: ReturnType<typeof createTargets> | undefined;
  let failed = false;
  try {
    const activeTargets = createTargets(vgpu, gpu, output.size);
    targets = activeTargets;
    setBindings(effects, activeTargets);
    setBakeUniforms(effects, activeTargets, settings);
    setPostUniforms(effects, activeTargets, settings);
    await prewarm(effects, activeTargets, output);
    const dt = opts.dt ?? 1 / 60;
    let time = opts.time ?? 2.5;
    const frames = Math.max(1, opts.warmupFrames ?? 1);
    for (let i = 0; i < frames; i++) {
      setShadeUniforms(effects, activeTargets, settings, time, 0);
      vgpu.frame(gpu, (currentFrame) =>
        renderChain(currentFrame, effects, activeTargets, output, i === 0)
      );
      time += dt;
    }
    await gpu.gpu.queue.onSubmittedWorkDone();
    await gpu.settled();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await Promise.allSettled([
      Promise.resolve().then(() => gpu.gpu.queue.onSubmittedWorkDone()),
      Promise.resolve().then(() => gpu.settled()),
    ]);
    let cleanupFailed = false;
    let cleanupFailure: unknown;
    try {
      if (targets) destroyTargets(targets);
    } catch (error) {
      cleanupFailed = true;
      cleanupFailure = error;
    }
    try {
      effects.noiseVolume.destroy();
    } catch (error) {
      if (!cleanupFailed) cleanupFailure = error;
      cleanupFailed = true;
    }
    if (!failed && cleanupFailed) throw cleanupFailure;
  }
}
