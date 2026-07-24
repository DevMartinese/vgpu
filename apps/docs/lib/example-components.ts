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
} satisfies Partial<Record<ExampleSlug, ExampleComponentLoader>>;

export function getExampleComponentLoader(slug: ExampleSlug): ExampleComponentLoader | undefined {
  return (exampleComponentLoaders as Partial<Record<ExampleSlug, ExampleComponentLoader>>)[slug];
}
