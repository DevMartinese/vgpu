/**
 * TGEIST-12 — every redirect the new app owes the old URL space.
 *
 * Three groups, three different reasons, all of them load-bearing for gate (d)
 * of Decision 4 (`scripts/check-url-anchor-parity.mjs`): a URL that prod serves
 * today counts as "resolved by the new tree" if it answers 200 **or** if it
 * redirects to something that does. Nothing here invents a redirect for
 * convenience; each entry closes a URL that exists in production right now.
 *
 *  1. `CONSOLIDATED_CONCEPT_GUIDES` — the 7 `/docs/guides/concepts-*` pages.
 *     Prod serves them (they are in `docs/url-inventory.json`, frozen from
 *     https://vgpu.sh); the new tree consolidates the same content under
 *     `/docs/concepts/*` (Decision 5: `lib/concepts.ts` and its bespoke parser
 *     are deleted, concepts come out of the generated pipeline like any other
 *     page). Without these 7 redirects the cutover breaks 7 live URLs — the
 *     single biggest handoff out of F1-F3.
 *
 *  2. `SECTION_ROOTS` — `/docs/get-started`, `/docs/concepts`, `/docs/guides`
 *     and `/docs/reference`. Prod serves all four (200, no anchors); the
 *     generated tree has no `index.md` in those directories, so fumadocs has no
 *     page at the folder URL and answers 404. The content fix (emit a real
 *     section index from the generator) belongs to whoever owns
 *     `content/docs/**` — this ticket may not hand-write files there — so the
 *     URL is kept alive by redirecting to the first page of the section, which
 *     is exactly what the sidebar highlights when you land there. Each target is
 *     the first entry of that directory's `meta.json`, and
 *     `check-url-anchor-parity.mjs` re-derives it from `meta.json` so a
 *     reordering that leaves this list stale fails CI instead of redirecting
 *     into the middle of a section.
 *
 *  3. `legacyTopLevelRedirects()` + the manifest-derived package/symbol
 *     redirects — ported from `apps/docs/next.config.mjs` (the app being
 *     replaced), which is the only place they exist today. They cover the
 *     pre-`/docs` URL space (`/guides/*`, `/reference/*`, `/cli`, `/ml/*`, …)
 *     and the `/packages/<pkg>/<Symbol>` deep links that published CLIs and old
 *     blog posts still emit. They are NOT in `docs/url-inventory.json` (that
 *     freeze only walked `/docs/**`), so no gate would have noticed them
 *     disappearing at cutover — which is precisely why they are ported here,
 *     under test, instead of being rediscovered from 404 logs in production.
 *
 * `permanent: false` everywhere, matching the old config verbatim: a 308 is
 * cached by browsers forever and this whole URL space is still moving.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { referencePackageName, slugifyPackage } from "./remark-geist/doc-link-index.mjs";

/** The 7 concept guides prod serves under `/docs/guides/concepts-*`. */
export const CONSOLIDATED_CONCEPT_GUIDES = [
  "compilation",
  "context",
  "draws",
  "effects",
  "frames",
  "passes",
  "render-bundles",
];

/**
 * Section directories with no `index.md` in `content/docs/**`, and the page
 * each one redirects to. The target must be the first real page of the
 * section's `meta.json` — asserted by `check-url-anchor-parity.mjs`.
 */
export const SECTION_ROOTS = [
  { source: "/docs/get-started", destination: "/docs/get-started/agents", dir: "get-started" },
  { source: "/docs/concepts", destination: "/docs/concepts/context", dir: "concepts" },
  { source: "/docs/guides", destination: "/docs/guides/getting-started", dir: "guides" },
  { source: "/docs/reference", destination: "/docs/reference/vgpu/init", dir: "reference" },
];

/**
 * `apps/docs/next.config.mjs`'s hand-written redirect list, ported verbatim
 * (order included). Comments that explain a specific entry are kept with it.
 */
export function legacyTopLevelRedirects() {
  return [
    { source: "/get-started", destination: "/docs/get-started", permanent: false },
    { source: "/get-started/:path*", destination: "/docs/get-started/:path*", permanent: false },
    { source: "/concepts", destination: "/docs/concepts", permanent: false },
    { source: "/concepts/:path*", destination: "/docs/concepts/:path*", permanent: false },
    { source: "/guides", destination: "/docs/guides", permanent: false },
    { source: "/guides/:path*", destination: "/docs/guides/:path*", permanent: false },
    { source: "/reference/vgpu/pass", destination: "/docs/reference/vgpu/effect", permanent: false },
    { source: "/reference", destination: "/docs/reference", permanent: false },
    { source: "/reference/:path*", destination: "/docs/reference/:path*", permanent: false },
    { source: "/cli", destination: "/docs/cli", permanent: false },
    // ML shipped after the /docs restructure and never got its pair. The topic
    // markdown links between its pages with logical paths (/ml/browser and
    // friends, straight out of docs/topics/ml.docs.md), exactly like every other
    // section does, so without these it is the one section whose cross-links 404.
    { source: "/ml", destination: "/docs/ml", permanent: false },
    { source: "/ml/:path*", destination: "/docs/ml/:path*", permanent: false },
    { source: "/api", destination: "/docs/reference", permanent: false },
    { source: "/packages", destination: "/docs/reference", permanent: false },
    { source: "/packages/vgpu/Pass", destination: "/docs/reference/vgpu/effect#effect", permanent: false },
    { source: "/packages/vgpu/PassOptions", destination: "/docs/reference/vgpu/effect#effectoptions", permanent: false },
    { source: "/getting-started", destination: "/docs/get-started", permanent: false },
  ];
}

/** `apps/docs/next.config.mjs`'s `legacyPackageSlug` — the SOURCE side of the
 * `/packages/*` redirects, and deliberately not `slugifyPackage` (which is the
 * DESTINATION side): the old URLs were minted before the `wgsl`/`wgsl-std`/
 * `render` shortenings existed, so `/packages/vgpu-wgsl-std/...` is the path in
 * the wild while the page now lives at `/docs/reference/wgsl-std/...`. */
function legacyPackageSlug(packageName) {
  return packageName.replace(/^@/u, "").replace(/[/@]/gu, "-");
}

/**
 * The two manifest-derived families from `apps/docs/next.config.mjs`:
 * `/packages/<pkg>` → the reference index anchor, and
 * `/packages/<pkg>/<Symbol>` → the topic page + symbol anchor.
 *
 * @param {import("./remark-geist/doc-link-index.mjs").DocsRecord[]} records
 */
export function manifestPackageRedirects(records) {
  const apiRecords = records.filter((record) => record.kind === "api");

  const packageRedirects = Array.from(new Set(apiRecords.map((record) => record.package))).map(
    (packageName) => ({
      source: `/packages/${legacyPackageSlug(packageName)}`,
      destination: `/docs/reference#${slugifyPackage(referencePackageName({ package: packageName }))}`,
      permanent: false,
    }),
  );

  const symbolRedirects = apiRecords.map((record) => ({
    source: `/packages/${legacyPackageSlug(record.package)}/${encodeURIComponent(record.symbol)}`,
    destination: `/docs/reference/${slugifyPackage(referencePackageName(record))}/${encodeURIComponent(record.topic)}#${record.anchor}`,
    permanent: false,
  }));

  return { packageRedirects, symbolRedirects };
}

/**
 * The complete list, in the order Next.js evaluates it (first match wins, so
 * the specific `/docs/**` entries come before the legacy prefix families).
 *
 * @param {import("./remark-geist/doc-link-index.mjs").DocsRecord[]} records
 */
export function buildDocsRedirects(records) {
  const conceptGuides = CONSOLIDATED_CONCEPT_GUIDES.map((slug) => ({
    source: `/docs/guides/concepts-${slug}`,
    destination: `/docs/concepts/${slug}`,
    permanent: false,
  }));

  const sectionRoots = SECTION_ROOTS.map(({ source, destination }) => ({
    source,
    destination,
    permanent: false,
  }));

  const { packageRedirects, symbolRedirects } = manifestPackageRedirects(records);

  return [
    ...conceptGuides,
    ...sectionRoots,
    ...legacyTopLevelRedirects(),
    ...packageRedirects,
    ...symbolRedirects,
  ];
}

/**
 * `import()` that a bundler cannot see. Next.js compiles `next.config.ts`
 * (unlike the old app's `next.config.mjs`, which Node loaded natively), so a
 * literal `await import(pathToFileURL(manifestPath).href)` — which is what
 * `loadDocsManifestRecords` in `lib/remark-geist/doc-link-index.mjs` does, and
 * what worked fine for `source.config.ts` — is rewritten into a bundler require
 * of a path outside the app and fails at build time with
 * `Cannot find module 'file:///…/docs-manifest.generated.js'` (verified: that is
 * exactly how this ticket's first build died). Constructing the importer through
 * `new Function` keeps the specifier opaque, so it stays a real runtime ESM
 * import of the committed 4.7 MB manifest.
 */
const runtimeImport = new Function("specifier", "return import(specifier);");

/**
 * Locates the committed docs manifest the same way
 * `lib/remark-geist/doc-link-index.mjs` does (module-relative first, then
 * `process.cwd()`), so the redirect table can be built from the app root, from
 * the repo root, or from a script.
 *
 * @param {{ manifestPath?: string, cwd?: string }} [options]
 */
function resolveManifestPath(options = {}) {
  if (options.manifestPath) return options.manifestPath;
  const cwd = options.cwd ?? process.cwd();
  const candidates = [
    fileURLToPath(new URL("../../../packages/vgpu/lib/generated/docs-manifest.generated.js", import.meta.url)),
    resolve(cwd, "../../packages/vgpu/lib/generated/docs-manifest.generated.js"),
    resolve(cwd, "packages/vgpu/lib/generated/docs-manifest.generated.js"),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `cannot find packages/vgpu/lib/generated/docs-manifest.generated.js (looked in: ${candidates.join(", ")})`,
    );
  }
  return found;
}

/**
 * `buildDocsRedirects` with the committed docs manifest loaded lazily — the
 * shape `next.config.ts`'s `async redirects()` wants. Loading it from disk
 * (instead of importing `@vgpu/cli`) keeps `apps/docs-next` free of that
 * dependency during the dual-run window, exactly like `source.config.ts` does.
 *
 * @param {{ manifestPath?: string, cwd?: string }} [options]
 */
export async function loadDocsRedirects(options = {}) {
  const manifestPath = resolveManifestPath(options);
  const module = await runtimeImport(pathToFileURL(manifestPath).href);
  const records = module?.docsManifest?.records;
  if (!Array.isArray(records)) {
    throw new Error(`docs manifest at ${manifestPath} has no \`docsManifest.records\` array`);
  }
  return buildDocsRedirects(records);
}
