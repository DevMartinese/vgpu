import { run as runTriangleLedFront } from '../examples/triangle-led-front/example';
import { run as runFluid } from '../examples/fluid/example';
import { run as runFftOcean } from '../examples/fft-ocean/example';
import { run as runRaymarchedFractal } from '../examples/raymarched-fractal/example';
import type { ExampleRunnerSlug } from './example-runner-slugs';

export type ExampleRunner = (canvas: HTMLCanvasElement) => Promise<() => void>;

export const exampleRunners = {
  'triangle-led-front': runTriangleLedFront,
  fluid: runFluid,
  'fft-ocean': runFftOcean,
  'raymarched-fractal': runRaymarchedFractal,
} satisfies Record<ExampleRunnerSlug, ExampleRunner>;

export function getExampleRunner(slug: string): ExampleRunner | undefined {
  return exampleRunners[slug as keyof typeof exampleRunners];
}
