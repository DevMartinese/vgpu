import {
  defineGeistdocsSourceConfig,
  geistdocsFrontmatterSchema,
  geistdocsMetaSchema,
} from "@vercel/geistdocs/source-config";
import { type DefaultMDXOptions, defineDocs } from "fumadocs-mdx/config";
import { bundledLanguages } from "shiki";

import {
  buildDocLinkIndex,
  loadDocsManifestRecords,
  remarkCalloutBlockquotes,
  remarkNormalizeCodeLang,
  remarkResolveDocLinks,
} from "./lib/remark-geist/index.mjs";

// You can customise Zod schemas for frontmatter and `meta.json` here
// see https://fumadocs.dev/docs/mdx/collections
export const docs = defineDocs({
  dir: "content/docs",
  docs: {
    schema: geistdocsFrontmatterSchema,
    postprocess: {
      includeProcessedMarkdown: true,
    },
  },
  meta: {
    schema: geistdocsMetaSchema,
  },
});

// TGEIST-05 — the render half of the double constraint (Decision 2 of the
// migration design): the `.md` bodies under `content/docs/**` are byte-identical
// to the authored `*.docs.md` sources, and every Geist component / resolved URL
// is produced HERE, on the mdast, at build time. Nothing rewrites a source file.
//
// The plugins live in `lib/remark-geist/` (unit-tested with `node --test`, see
// `pnpm --filter docs-next test:remark`) and implement the mechanical mappings
// M1-M9 of the inventory in Decision 2.4:
//
//   remarkNormalizeCodeLang   M4 ` ```terminal ` -> bash  (19 fences; leaving
//                                them alone makes Shiki throw and there is no
//                                build at all — same failure eve hit, whose
//                                `remarkNormalizeCodeLang` this is modelled on)
//                             M5 `sh`/`typescript` alias normalization
//                             M6 `ts`/`wgsl`/`json`: nothing to do, Shiki 3.x
//                                bundles all three
//   remarkCalloutBlockquotes  M1 `> Good to know:` -> <Callout type="info">
//                             M2 `> Warning:`      -> <Callout type="warn">
//                                (prefix kept verbatim inside the Callout;
//                                 `type` values verified against
//                                 fumadocs-ui/dist/components/callout.d.ts)
//                             M3 every other blockquote: untouched
//   remarkResolveDocLinks     M7 relative `*.docs.md` -> `/docs/...` (52 links)
//                             M8 bare logical paths   -> `/docs/...` (33 links)
//                             M9 anchor-only links: untouched
//
// Order matters and is fixed on purpose: code languages first (a bad fence
// aborts everything), blockquotes second, links last — by then anything that
// looks like a link but lives in a fence is still a `code` node, never a `link`.
//
// The link pass runs on `link`/`definition` nodes only, never on text: the
// corpus contains `npx vgpu docs cat /@vgpu/wgsl/runtime/resolve-shader.docs.md`
// inside a code-span on the same line as a real link to the same path
// (docs/topics/no-bundler.docs.md:53). A regex would rewrite the command a
// reader is supposed to copy; an AST pass cannot even see it.
//
// The slug -> URL table is the committed docs manifest, loaded lazily on the
// first compiled file (`loadIndex`), so this config needs no top-level await and
// `apps/docs-next` needs no dependency on `@vgpu/cli` during the dual-run window.
// NOTE the `[attacher, options]` tuple shape: unified calls each entry of the
// plugins array as an attacher and registers what it RETURNS. Passing
// `remarkNormalizeCodeLang({ … })` here instead compiles fine, type-checks fine,
// and silently registers nothing — the first build of this ticket failed with
// `ShikiError: Language 'terminal' is not included in this bundle` for exactly
// that reason. `geistRemarkPlugins()` in lib/remark-geist/index.mjs builds the
// same list; it is kept inline here so the chain and its order are readable in
// the config the way eve's is.
const remarkGeistPlugins: NonNullable<DefaultMDXOptions["remarkPlugins"]> = [
  [
    remarkNormalizeCodeLang,
    {
      // Shiki's own language list, so any future unknown-but-identifier-shaped
      // fence label degrades to `text` instead of failing the build.
      knownLanguages: Object.keys(bundledLanguages),
    },
  ],
  [remarkCalloutBlockquotes, {}],
  [
    remarkResolveDocLinks,
    {
      loadIndex: async () => {
        const { records } = await loadDocsManifestRecords();
        return buildDocLinkIndex(records);
      },
      // An unresolved `*.docs.md` link is a silent 404 in production (risk #6 of
      // the design), so it fails the build instead of shipping.
      onUnresolvedMarkdownLink: "error",
    },
  ],
] as const;

export default defineGeistdocsSourceConfig({
  mdxOptions: {
    // Appended after geistdocs' own defaults (it prepends `remarkMdxMermaid`).
    remarkPlugins: remarkGeistPlugins,
  },
});
