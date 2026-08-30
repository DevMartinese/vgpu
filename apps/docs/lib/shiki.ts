import { geistShikiTheme } from "@vercel/geistdocs/shiki-theme";
import { createHighlighter, type Highlighter, type ThemeRegistrationAny } from "shiki";

// TGEIST-09c: ported from `apps/docs/lib/shiki.ts` (the old app's code-viewer
// highlighter) -- singleton `shiki` highlighter cached on `globalThis` so
// dev-mode module reloads don't spin up a second WASM instance, WGSL grammar
// included alongside the usual web languages so example shader source
// highlights correctly.
//
// Theme: `geistShikiTheme` from `@vercel/geistdocs/shiki-theme`, the exact
// same theme object geistdocs' own MDX pipeline registers for both the
// `light` and `dark` keys (`@vercel/geistdocs/dist/source-config.js`). It is
// a css-variables theme -- every token color is emitted as
// `var(--shiki-token-*)` instead of a literal hex -- and those variables are
// defined theme-aware in `@vercel/geistdocs/theme.css` (`:root` values that
// flip under `.dark`), which the app already loads site-wide via
// `app/styles/geistdocs.css`. Previously this hardcoded `github-dark`, which
// baked literal dark-mode hex into the build-time HTML and left the example
// code viewer stuck dark in light mode. Referencing the registered theme by
// `name` ("geist") keeps `codeToHtml` on the pre-loaded theme path.
const theme = geistShikiTheme as ThemeRegistrationAny;

const globalForHighlighter = globalThis as unknown as {
  highlighterPromise?: Promise<Highlighter>;
};

export async function getHighlighter() {
  if (!globalForHighlighter.highlighterPromise) {
    globalForHighlighter.highlighterPromise = createHighlighter({
      themes: [theme],
      langs: ["typescript", "javascript", "tsx", "jsx", "json", "bash", "html", "css", "wgsl"],
    });
  }
  return globalForHighlighter.highlighterPromise;
}

export async function highlightCode(code: string, language: string): Promise<string> {
  const highlighter = await getHighlighter();
  const html = highlighter.codeToHtml(code.trim(), {
    lang: language,
    theme: geistShikiTheme.name,
  });

  // Shiki renders blank source lines as an empty `<span class="line"></span>`
  // with no content, which collapses to zero height in some browsers.
  // Give it a non-breaking space so blank lines keep their line height.
  return html.replace(/<span class="line"><\/span>/g, '<span class="line">&nbsp;</span>');
}
