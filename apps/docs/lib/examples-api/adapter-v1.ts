import type { ExampleByteGraph, ExampleGraphSource, UnhashedExampleRecord } from './byte-graph';
import { buildByteGraph } from './hashing';

/**
 * Isolated seam for React's foundation-stable, data-only ingestion export.
 * The React coordinator will provide these records after all examples migrate; no
 * UI module or source transformation is permitted here.
 */
export function adaptCanonicalExamples(
  records: readonly UnhashedExampleRecord[],
  source: ExampleGraphSource,
): ExampleByteGraph {
  return buildByteGraph(records, source);
}
