import type { ComponentType } from 'react';
import type { ExampleSlug } from './example-slugs';

export interface ExampleComponentModule {
  readonly Example: ComponentType;
}

export type ExampleComponentLoader = () => Promise<ExampleComponentModule>;

export const exampleComponentLoaders = {
  gradient: () => import('../examples/gradient'),
  'triangle-led-front': () => import('../examples/triangle-led-front'),
  'anti-aliasing': () => import('../examples/anti-aliasing'),
  'post-processing': () => import('../examples/post-processing'),
  'black-hole': () => import('../examples/black-hole'),
  fluid: () => import('../examples/fluid'),
  'instanced-rendering': () => import('../examples/instanced-rendering'),
  'batch-rendering': () => import('../examples/batch-rendering'),
  'fft-ocean': () => import('../examples/fft-ocean'),
  'raymarched-fractal': () => import('../examples/raymarched-fractal'),
} satisfies Record<ExampleSlug, ExampleComponentLoader>;

export function getExampleComponentLoader(slug: ExampleSlug): ExampleComponentLoader {
  return exampleComponentLoaders[slug];
}
