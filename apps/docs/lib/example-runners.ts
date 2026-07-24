import { run as runTriangleLedFront } from '../examples/triangle-led-front/example';
import { run as runFftOcean } from '../examples/fft-ocean/example';
import type { ExampleRunnerSlug } from './example-runner-slugs';

export type ExampleRunner = (canvas: HTMLCanvasElement) => Promise<() => void>;

export const exampleRunners = {
  'triangle-led-front': runTriangleLedFront,
  'fft-ocean': runFftOcean,
} satisfies Record<ExampleRunnerSlug, ExampleRunner>;

export function getExampleRunner(slug: string): ExampleRunner | undefined {
  return exampleRunners[slug as keyof typeof exampleRunners];
}
