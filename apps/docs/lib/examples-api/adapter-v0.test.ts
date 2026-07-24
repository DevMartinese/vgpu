import { describe, expect, it } from 'vitest';
import { exampleSources } from '../examples-source.generated';
import fractalFixture from './fixtures/raymarched-fractal.json';
import { createLegacyByteGraph } from './adapter-v0';

const source = { repository: 'https://github.com/vgpu/vgpu', gitCommit: '75cd72b10d1cd8e629391f9fc6276c50e3553d26' };

describe('legacy byte graph adapter', () => {
  it('preserves every CodeViewer transport byte and display order', () => {
    const graph = createLegacyByteGraph(source);
    expect(graph.examples).toHaveLength(10);
    const sources = exampleSources as Readonly<Record<string, readonly { name: string; code: string }[]>>;
    for (const example of graph.examples) {
      expect(example.files.map((file) => file.path)).toEqual(sources[example.id]!.map((file) => file.name));
      expect(example.files.map((file) => file.text)).toEqual(sources[example.id]!.map((file) => file.code));
    }
  });

  it('locks fractal controlled terms and ordered source fixture', () => {
    const fractal = createLegacyByteGraph(source).examples.find((example) => example.id === fractalFixture.id)!;
    expect(fractal.metadata.tags).toEqual(fractalFixture.metadata.tags);
    expect(fractal.metadata.capabilities).toEqual(fractalFixture.metadata.capabilities);
    expect(fractal.files.map((file) => file.path)).toEqual(fractalFixture.orderedPaths);
  });
});
