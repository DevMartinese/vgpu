import { exampleSources, type ExampleSourceFile } from '../examples-source.generated';
import { meta as gradient } from '../../examples/gradient/meta';
import { meta as triangleLedFront } from '../../examples/triangle-led-front/meta';
import { meta as antiAliasing } from '../../examples/anti-aliasing/meta';
import { meta as postProcessing } from '../../examples/post-processing/meta';
import { meta as blackHole } from '../../examples/black-hole/meta';
import { meta as fluid } from '../../examples/fluid/meta';
import { meta as instancedRendering } from '../../examples/instanced-rendering/meta';
import { meta as batchRendering } from '../../examples/batch-rendering/meta';
import { meta as fftOcean } from '../../examples/fft-ocean/meta';
import { meta as raymarchedFractal } from '../../examples/raymarched-fractal/meta';
import type { ExampleByteGraph, ExampleGraphSource, ExampleMetadata, UnhashedExampleRecord } from './byte-graph';
import { buildByteGraph } from './hashing';

export interface LegacyMeta {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
}

const orderedMetas: readonly LegacyMeta[] = [
  gradient, triangleLedFront, antiAliasing, postProcessing, blackHole,
  fluid, instancedRendering, batchRendering, fftOcean, raymarchedFractal,
];

// v0 supplies controlled metadata absent from the regex-era meta files. It is removed
// when adapter-v1 switches to React's typed data-only metadata contract.
const legacyVocabulary: Readonly<Record<string, Pick<ExampleMetadata, 'tags' | 'capabilities'>>> = {
  gradient: { tags: ['gradient', 'rendering'], capabilities: [] },
  'triangle-led-front': { tags: ['animation', 'rendering'], capabilities: ['controls'] },
  'anti-aliasing': { tags: ['anti-aliasing', 'rendering'], capabilities: ['controls', 'multi-pass', 'textures'] },
  'post-processing': { tags: ['post-processing', 'bloom', 'rendering'], capabilities: ['controls', 'multi-pass', 'textures'] },
  'black-hole': { tags: ['raymarching', 'hdr', 'bloom'], capabilities: ['hdr', 'multi-pass', 'textures'] },
  fluid: { tags: ['fluid', 'compute', 'animation'], capabilities: ['compute', 'controls', 'storage-buffers'] },
  'instanced-rendering': { tags: ['instancing', 'rendering'], capabilities: ['instancing'] },
  'batch-rendering': { tags: ['batching', 'rendering'], capabilities: ['render-bundles'] },
  'fft-ocean': { tags: ['fft', 'ocean', 'particles', 'hdr', 'bloom'], capabilities: ['compute', 'hdr', 'multi-pass', 'storage-buffers'] },
  'raymarched-fractal': {
    tags: ['raymarching', 'raymarch', 'fractal', 'sierpinski', 'hdr', 'bloom'],
    capabilities: ['controls', 'hdr', 'multi-pass'],
  },
};

export function adaptLegacySources(
  sources: Readonly<Record<string, readonly ExampleSourceFile[]>>,
  metas: readonly LegacyMeta[],
  source: ExampleGraphSource,
): ExampleByteGraph {
  const records: UnhashedExampleRecord[] = metas.map((meta) => {
    const vocabulary = legacyVocabulary[meta.slug];
    if (!vocabulary) throw new Error(`Missing controlled vocabulary for ${meta.slug}`);
    const sourceFiles = sources[meta.slug];
    if (!sourceFiles) throw new Error(`Missing generated source for ${meta.slug}`);
    return {
      id: meta.slug,
      metadata: { title: meta.title, description: meta.description, ...vocabulary },
      files: sourceFiles.map((file) => ({
        path: file.name,
        text: file.code,
        contentType: contentType(file.name),
      })),
    };
  });
  return buildByteGraph(records, source);
}

export function createLegacyByteGraph(source: ExampleGraphSource): ExampleByteGraph {
  return adaptLegacySources(exampleSources, orderedMetas, source);
}

function contentType(path: string): 'text/typescript' | 'text/wgsl' | 'text/plain' {
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'text/typescript';
  if (path.endsWith('.wgsl')) return 'text/wgsl';
  return 'text/plain';
}
