import type { ComponentType } from 'react';
import type { ExampleSlug } from './example-slugs';

export interface ExampleComponentModule {
  readonly Example: ComponentType;
}

export type ExampleComponentLoader = () => Promise<ExampleComponentModule>;

/**
 * Literal imports are added here as example folders migrate. Keeping this map
 * partial lets the preview bridge route the remaining examples to legacy runners.
 */
export const exampleComponentLoaders = {
  gradient: () => import('../examples/gradient'),
  'anti-aliasing': () => import('../examples/anti-aliasing'),
  'post-processing': () => import('../examples/post-processing'),
  'black-hole': () => import('../examples/black-hole'),
  fluid: () => import('../examples/fluid'),
  'instanced-rendering': () => import('../examples/instanced-rendering'),
  'batch-rendering': () => import('../examples/batch-rendering'),
  'raymarched-fractal': () => import('../examples/raymarched-fractal'),
} satisfies Partial<Record<ExampleSlug, ExampleComponentLoader>>;

export function getExampleComponentLoader(slug: ExampleSlug): ExampleComponentLoader | undefined {
  return (exampleComponentLoaders as Partial<Record<ExampleSlug, ExampleComponentLoader>>)[slug];
}
