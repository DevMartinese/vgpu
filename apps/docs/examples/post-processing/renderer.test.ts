import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, test } from 'vitest'; import { Controls } from './controls'; import { DEFAULT_POST_PROCESSING_CONTROLS } from './types';
test('uses shared all-on defaults in accessible controlled toggles',()=>{const html=renderToStaticMarkup(createElement(Controls, { value: DEFAULT_POST_PROCESSING_CONTROLS, onChange: () => {} }));expect(DEFAULT_POST_PROCESSING_CONTROLS).toEqual({bloom:true,ca:true});expect(html).toContain('Post-processing effects');expect(html.match(/checked=""/g)).toHaveLength(2);expect(html).toContain('Chromatic Aberration');});
