export const exampleRunnerSlugs = [
  'triangle-led-front',
  'fluid',
  'fft-ocean',
  'raymarched-fractal',
] as const;

export type ExampleRunnerSlug = (typeof exampleRunnerSlugs)[number];
