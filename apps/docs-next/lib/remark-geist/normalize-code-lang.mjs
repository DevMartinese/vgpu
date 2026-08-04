/**
 * M4 / M5 / M6 of the mapping inventory (Decision 2.4): fenced code languages.
 *
 * M4 is the mapping that **breaks the build if it is missing**: the vgpu corpus
 * has 19 ` ```terminal ` fences and `terminal` is not a Shiki language, so
 * `rehypeCode` throws while highlighting. M5 normalizes the aliases the corpus
 * mixes (`sh` 22×, `typescript` 3×) to one spelling so the code-block chrome is
 * consistent. M6 (`ts` 592×, `wgsl` 30×, `json` 4×) needs no work at all —
 * Shiki 3.x bundles all three, including WGSL.
 *
 * Shape copied from `remarkNormalizeCodeLang` in
 * `/home/user/eve/apps/docs/source.config.ts` (a geistdocs 1.15.2 site already
 * in production): unknown label → `text`, original label preserved as fence
 * meta so it still renders above the block. What is adapted here:
 *
 *  - an explicit **alias table** (eve had none: its bad labels were line-range
 *    file paths, ours is the identifier-shaped-but-unknown `terminal`);
 *  - an optional `knownLanguages` set (Shiki's own `bundledLanguages` keys are
 *    passed in from `source.config.ts`) so *any* future unknown-but-
 *    identifier-shaped label degrades to `text` instead of failing the build;
 *  - aliased fences do **not** get fence meta. The original label is recorded
 *    in `node.data.geistOriginalLang` (invisible, useful in tests and when
 *    debugging) instead, because a bare `terminal` meta string carries no
 *    information a reader needs and could surface as a code-block title. Bad
 *    *labels* (`384:401:src/x.ts`) do keep the meta: there the label IS the
 *    information.
 *
 * Text is never touched, so the parity gate (Decision 4c) holds trivially:
 * `lang`, `meta` and `data` are not text nodes.
 */

import { visit } from "./mdast-utils.mjs";

/**
 * Fence labels the corpus uses that are either unknown to Shiki (`terminal`) or
 * a second spelling of a language it already knows (`sh`, `typescript`).
 * Lowercased keys; lookup is case-insensitive.
 *
 * `text` is Shiki's plain-text special language (it is deliberately absent from
 * `bundledLanguages`), so `txt`/`plain`/`plaintext` collapse onto it.
 */
export const DEFAULT_LANGUAGE_ALIASES = Object.freeze({
  // M4 — obligatory: not a Shiki language, 19 occurrences, breaks the build.
  terminal: "bash",
  // M5 — alias normalization (chrome consistency only; both sides are valid Shiki languages).
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  typescript: "ts",
  javascript: "js",
  txt: "text",
  plain: "text",
  plaintext: "text",
});

/**
 * Shiki resolves these to "no highlighting" instead of looking them up in the
 * grammar registry, so they are valid even though `bundledLanguages` has no
 * such key.
 */
export const SHIKI_SPECIAL_LANGUAGES = Object.freeze(["text", "txt", "plaintext", "plain", "ansi"]);

/** A fence label that could plausibly be a language identifier. */
const LANGUAGE_IDENTIFIER = /^[a-zA-Z][a-zA-Z0-9+#-]*$/u;

/**
 * @typedef {Object} NormalizeCodeLangOptions
 * @property {Record<string, string>} [aliases] Overrides `DEFAULT_LANGUAGE_ALIASES`.
 * @property {Iterable<string>} [knownLanguages] Languages Shiki can highlight.
 *   Anything not in the set (and not a special language) degrades to `text`.
 *   Omit to skip the check and only apply the alias table + the identifier
 *   shape check.
 * @property {string} [fallbackLanguage] Defaults to `text`.
 */

/**
 * remark plugin: normalizes `code` node languages.
 *
 * @param {NormalizeCodeLangOptions} [options]
 */
export function remarkNormalizeCodeLang(options = {}) {
  const aliases = options.aliases ?? DEFAULT_LANGUAGE_ALIASES;
  const fallback = options.fallbackLanguage ?? "text";
  const known = options.knownLanguages ? new Set(options.knownLanguages) : null;
  if (known) for (const special of SHIKI_SPECIAL_LANGUAGES) known.add(special);

  return (/** @type {import("./mdast-utils.mjs").MdastNode} */ tree) => {
    visit(tree, (node) => {
      if (node.type !== "code") return;
      // A fence with no info string stays as-is: 744 of them in the corpus, and
      // Shiki renders them unhighlighted. Guessing a language here would be a
      // visual change, not a mechanical mapping (Decision 2.4, M5).
      if (typeof node.lang !== "string" || node.lang.length === 0) return;

      const original = node.lang;
      const lower = original.toLowerCase();

      const alias = Object.hasOwn(aliases, lower) ? aliases[lower] : undefined;
      if (alias && alias !== original) {
        node.lang = alias;
        node.data = { ...(node.data ?? {}), geistOriginalLang: original };
        return;
      }

      const isIdentifier = LANGUAGE_IDENTIFIER.test(original);
      const isKnown = known ? known.has(lower) : true;
      if (isIdentifier && isKnown) return;

      // Unknown to Shiki (or not even identifier-shaped): degrade to plain text
      // and keep the label visible as fence meta, exactly like eve does.
      node.meta = node.meta ? `${original} ${node.meta}` : original;
      node.lang = fallback;
      node.data = { ...(node.data ?? {}), geistOriginalLang: original };
    });
  };
}

export default remarkNormalizeCodeLang;
