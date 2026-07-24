import type { ExampleRunnerSlug } from './example-runner-slugs';

export type ExampleRunner = (canvas: HTMLCanvasElement) => Promise<() => void>;

export const exampleRunners = {} satisfies Record<ExampleRunnerSlug, ExampleRunner>;

export function getExampleRunner(slug: string): ExampleRunner | undefined {
  return exampleRunners[slug as keyof typeof exampleRunners];
}
