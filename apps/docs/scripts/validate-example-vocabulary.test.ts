import { describe, expect, it } from 'vitest';
import { validateExampleVocabulary, validateValues } from './validate-example-vocabulary.mjs';

describe('example vocabulary validation', () => {
  it('accepts the checked-in vocabularies, fixtures, and authored metadata', async () => {
    await expect(validateExampleVocabulary()).resolves.toBeUndefined();
  });

  it('rejects unknown, non-lowercase, and duplicate terms', () => {
    const allowed = new Set(['raymarching']);
    expect(() => validateValues('tag', 'x', ['unknown'], allowed)).toThrow(/unknown/);
    expect(() => validateValues('tag', 'x', ['Raymarching'], allowed)).toThrow(/lowercase/);
    expect(() => validateValues('tag', 'x', ['raymarching', 'raymarching'], allowed)).toThrow(/duplicate/);
  });
});
