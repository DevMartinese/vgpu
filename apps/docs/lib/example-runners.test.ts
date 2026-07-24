import { expect, test } from 'vitest';

import { exampleRunnerSlugs } from './example-runner-slugs';
import { exampleRunners } from './example-runners';

test('runner map exactly covers the legacy runner slugs', () => {
  expect(Object.keys(exampleRunners)).toEqual(exampleRunnerSlugs);
});
