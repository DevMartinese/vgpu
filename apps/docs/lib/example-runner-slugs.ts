export const exampleRunnerSlugs = [
  'triangle-led-front',
  'fft-ocean',
] as const;

export type ExampleRunnerSlug = (typeof exampleRunnerSlugs)[number];
