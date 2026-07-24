import { exampleThumbs } from './example-thumbs.generated';
import type { ExampleMeta, LegacyExampleMetaDefinition } from './example-meta';
import { exampleSlugs, type ExampleSlug } from './example-slugs';

import { meta as gradientMeta } from '../examples/gradient/meta';
import { meta as triangleLedFrontMeta } from '../examples/triangle-led-front/meta';
import { meta as antiAliasingMeta } from '../examples/anti-aliasing/meta';
import { meta as postProcessingMeta } from '../examples/post-processing/meta';
import { meta as blackHoleMeta } from '../examples/black-hole/meta';
import { meta as fluidMeta } from '../examples/fluid/meta';
import { meta as instancedRenderingMeta } from '../examples/instanced-rendering/meta';
import { meta as batchRenderingMeta } from '../examples/batch-rendering/meta';
import { meta as fftOceanMeta } from '../examples/fft-ocean/meta';
import { meta as raymarchedFractalMeta } from '../examples/raymarched-fractal/meta';

const rawMetadata = {
  gradient: gradientMeta,
  'triangle-led-front': triangleLedFrontMeta,
  'anti-aliasing': antiAliasingMeta,
  'post-processing': postProcessingMeta,
  'black-hole': blackHoleMeta,
  fluid: fluidMeta,
  'instanced-rendering': instancedRenderingMeta,
  'batch-rendering': batchRenderingMeta,
  'fft-ocean': fftOceanMeta,
  'raymarched-fractal': raymarchedFractalMeta,
} satisfies Record<ExampleSlug, LegacyExampleMetaDefinition>;

function normalizeMetadata(meta: LegacyExampleMetaDefinition): ExampleMeta {
  return {
    ...meta,
    tags: meta.tags ?? [],
    capabilities: meta.capabilities ?? [],
    thumbnail: exampleThumbs[meta.slug]?.card,
    hero: exampleThumbs[meta.slug]?.hero,
  };
}

export const exampleMetadataBySlug = {
  gradient: normalizeMetadata(rawMetadata.gradient),
  'triangle-led-front': normalizeMetadata(rawMetadata['triangle-led-front']),
  'anti-aliasing': normalizeMetadata(rawMetadata['anti-aliasing']),
  'post-processing': normalizeMetadata(rawMetadata['post-processing']),
  'black-hole': normalizeMetadata(rawMetadata['black-hole']),
  fluid: normalizeMetadata(rawMetadata.fluid),
  'instanced-rendering': normalizeMetadata(rawMetadata['instanced-rendering']),
  'batch-rendering': normalizeMetadata(rawMetadata['batch-rendering']),
  'fft-ocean': normalizeMetadata(rawMetadata['fft-ocean']),
  'raymarched-fractal': normalizeMetadata(rawMetadata['raymarched-fractal']),
} satisfies Record<ExampleSlug, ExampleMeta>;

export const examplesMetadata = exampleSlugs.map((slug) => exampleMetadataBySlug[slug]);

export function getExampleMetadata(slug: string): ExampleMeta | undefined {
  return exampleMetadataBySlug[slug as ExampleSlug];
}
