import { expect, test, vi } from 'vitest';
import { createDeduplicatedExampleErrorReporter } from './example-error-reporter';

test('the first renderer failure is displayed and posted exactly once', () => {
  const displayError = vi.fn();
  const postError = vi.fn();
  const reportError = createDeduplicatedExampleErrorReporter(displayError, postError);
  const first = new Error('GPU initialization failed');

  reportError(first);
  reportError(new Error('duplicate callback'));

  expect(displayError).toHaveBeenCalledOnce();
  expect(displayError).toHaveBeenCalledWith(first);
  expect(postError).toHaveBeenCalledOnce();
  expect(postError).toHaveBeenCalledWith(first);
});
