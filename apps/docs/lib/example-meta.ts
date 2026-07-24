import type { ExampleSlug } from './example-slugs';

export interface ExampleThumbOptions {
  readonly warmupFrames?: number;
  readonly time?: number;
  readonly dt?: number;
  readonly headless?: boolean;
  readonly note?: string;
  readonly fragmentFile?: string;
}

/** Data-only contract for a migrated example's meta.ts export. */
export interface ExampleMetaDefinition {
  readonly slug: ExampleSlug;
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly capabilities: readonly string[];
  readonly files: readonly string[];
  readonly thumb?: ExampleThumbOptions;
}

/** Temporary bridge for meta.ts files which have not migrated yet. */
export type LegacyExampleMetaDefinition = Omit<ExampleMetaDefinition, 'tags' | 'capabilities'> & {
  readonly tags?: readonly string[];
  readonly capabilities?: readonly string[];
};

export interface ExampleMeta extends ExampleMetaDefinition {
  readonly thumbnail?: string;
  readonly hero?: string;
}
