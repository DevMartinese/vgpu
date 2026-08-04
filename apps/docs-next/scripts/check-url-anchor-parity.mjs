#!/usr/bin/env node
/**
 * Gate (d) of Decision 4 — **URL + anchor parity against production**. TGEIST-12.
 *
 * `docs/url-inventory.json` was frozen during F1 by crawling the live site
 * (https://vgpu.sh): every URL it serves under `/docs/**` and, per URL, every
 * anchor that really exists as an `id=` in the HTML prod returns. That file is
 * the oracle here, and this script is the only thing standing between the
 * cutover and a silently broken URL space: `next build` is perfectly happy to
 * ship a tree where 11 live URLs 404, because from the build's point of view
 * nothing is missing — every page it was asked to render rendered.
 *
 * For each frozen page:
 *
 *   1. GET the path off a real server (`next start` on the production build, so
 *      `next.config.ts` redirects and the geistdocs i18n proxy are both in the
 *      loop — a static-export diff would see neither).
 *   2. Follow redirects **manually**, recording the chain. A 3xx landing on a
 *      200 counts as resolved: a redirect is a URL that still works, which is
 *      the property prod readers care about. The chain is always printed, so a
 *      redirect is never invisible.
 *   3. Require the ids of the final HTML to be a superset of the frozen anchors.
 *      Extra ids are fine (the new layout mints its own); missing ones are
 *      classified — see below — and anything unclassifiable fails.
 *
 * ## Why anchors need classification instead of plain equality
 *
 * The old app and geistdocs slug headings with different code. The old app used
 * `slugifyHeading` over the heading's *plain* text (`apps/docs/lib/concepts.ts:185`,
 * ported below); fumadocs uses github-slugger over the heading's *rendered*
 * text. Three consequences, all of them visible in the frozen inventory:
 *
 *   - inline code counted: `Type \`.wgsl\` imports in TypeScript` was
 *     `#type-imports-in-typescript`, is now `#type-wgsl-imports-in-typescript`;
 *   - `-+` no longer collapses: `Headless / no-bundler variant` was
 *     `#headless-no-bundler-variant`, is now `#headless--no-bundler-variant`;
 *   - duplicate-heading counters restart per page, where the old reference pages
 *     shared a slugger across a whole package (hence prod's `#import-29`), and
 *     headings whose text was entirely code slugged to the empty string and came
 *     out as prod's `#-2`, `#-3`, …
 *
 * A gate that only diffed sets would report all of that as "94 anchors lost" and
 * be permanently red, which in practice means switched off. A gate that ignored
 * missing anchors would miss the thing that actually matters: a **heading that
 * disappeared**. So every missing anchor is matched back to a heading of the
 * page it should be on, by recomputing the OLD slug from the NEW HTML (with and
 * without code spans, modulo the dedup counter):
 *
 *   - matches the page's own `<h1>` (the frontmatter title, rendered without an
 *     `id` by the Geist layout)  →  `title`, accepted by rule. The fragment
 *     still lands the reader on the page with that heading at the top of the
 *     viewport, which is where `#cli` scrolled to anyway.
 *   - matches a body heading → `drift`: the section is still there, its id
 *     changed. Accepted **only if recorded** in
 *     `scripts/url-anchor-drift-allowlist.json`, with the new id. A drift that
 *     is not in the file fails; a recorded drift whose new id changed fails; a
 *     recorded drift that no longer happens fails as stale. So the 94 known
 *     renames cannot grow silently, and no entry can hide a lost heading — the
 *     heading has to still exist for the entry to match.
 *   - matches nothing → **fail**: content is gone (or a plugin ate it).
 *
 * ## Usage
 *
 *   node scripts/check-url-anchor-parity.mjs                  # starts `next start` itself
 *   node scripts/check-url-anchor-parity.mjs --base-url=http://localhost:3000
 *   node scripts/check-url-anchor-parity.mjs --json=report.json
 *   node scripts/check-url-anchor-parity.mjs --write-allowlist # re-record the drifts
 *
 * Needs a production build in `.next` (CI runs it right after `next build`, in
 * the same job). Exits non-zero with an itemized list of gaps.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { SECTION_ROOTS } from "../lib/docs-redirects.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(APP_ROOT, "../..");
const INVENTORY_PATH = join(REPO_ROOT, "docs/url-inventory.json");
const CONTENT_ROOT = join(APP_ROOT, "content/docs");
const ALLOWLIST_PATH = join(SCRIPT_DIR, "url-anchor-drift-allowlist.json");
const MAX_REDIRECT_HOPS = 5;
const READY_TIMEOUT_MS = 120_000;

/** `apps/docs/lib/concepts.ts:185` (`slugifyHeading`), ported verbatim. */
function slugifyHeading(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/gu, "")
    .replace(/\s+/gu, "-")
    .replace(/-+/gu, "-");
}

/** Drops the trailing duplicate-heading counter (`import-29` → `import`, `-2` → ``). */
function withoutDedupCounter(anchor) {
  return anchor.replace(/-\d+$/u, "");
}

function parseArgs(argv) {
  const options = { baseUrl: null, json: null, writeAllowlist: false };
  for (const arg of argv) {
    const eq = arg.indexOf("=");
    const [key, value] = eq === -1 ? [arg, ""] : [arg.slice(0, eq), arg.slice(eq + 1)];
    if (key === "--base-url") options.baseUrl = value.replace(/\/$/u, "");
    else if (key === "--json") options.json = value;
    else if (key === "--write-allowlist") options.writeAllowlist = true;
    else {
      console.error(`unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

async function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function waitForServer(baseUrl, child) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`\`next start\` exited with code ${child.exitCode} before becoming ready`);
    }
    try {
      const response = await fetch(`${baseUrl}/docs`, { redirect: "manual" });
      if (response.status > 0) return;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server at ${baseUrl} did not become ready within ${READY_TIMEOUT_MS}ms`);
}

async function startServer() {
  const bin = join(APP_ROOT, "node_modules/.bin/next");
  if (!existsSync(bin)) throw new Error(`cannot find the next binary at ${bin} — run pnpm install`);
  if (!existsSync(join(APP_ROOT, ".next"))) {
    throw new Error(
      `no production build at ${join(APP_ROOT, ".next")} — this gate grades a real server, run \`pnpm --filter docs-next build\` first`,
    );
  }
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const child = spawn(bin, ["start", "--port", String(port)], {
    cwd: APP_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = [];
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));
  try {
    await waitForServer(baseUrl, child);
  } catch (error) {
    child.kill("SIGKILL");
    console.error(log.join(""));
    throw error;
  }
  return { baseUrl, stop: () => child.kill("SIGTERM") };
}

/** Every `id="…"` in the document. Extra ids are not a failure, missing ones are. */
function extractIds(html) {
  const ids = new Set();
  for (const match of html.matchAll(/\sid="([^"]*)"/gu)) ids.add(match[1]);
  return ids;
}

function decodeEntities(text) {
  return text
    .replace(/&#x27;|&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&#x2F;/gu, "/")
    .replace(/&nbsp;/gu, " ")
    .replace(/&amp;/gu, "&");
}

function htmlToText(html) {
  return decodeEntities(html.replace(/<[^>]*>/gu, " ")).replace(/\s+/gu, " ").trim();
}

/** `htmlToText` with `<code>` elements removed first — the old app's heading text. */
function htmlToTextWithoutCode(html) {
  return htmlToText(html.replace(/<code\b[^>]*>[\s\S]*?<\/code>/giu, " "));
}

/**
 * Heading tags, tolerating `>` inside quoted attribute values (Tailwind emits
 * arbitrary variants like `[&>code]:…`, which a plain `[^>]*` would truncate).
 * `h1` is included on purpose: the reference pages open every symbol with a
 * level-1 markdown heading, so most body anchors on `/docs/reference/**` live on
 * an `<h1 id="…">`. The layout's own title is the one `h1` with no `id`.
 */
const HEADING_RE = /<h([1-6])((?:"[^"]*"|[^>])*)>([\s\S]*?)<\/h\1>/giu;

/**
 * Body headings of the served page, each with the two candidate legacy slugs:
 * how `slugifyHeading` would have slugged its text with, and without, the text
 * of its inline-code spans (prod dropped it, github-slugger keeps it).
 */
function extractHeadings(html) {
  const headings = [];
  for (const match of html.matchAll(HEADING_RE)) {
    const [, level, attributes, inner] = match;
    const idMatch = /\sid="([^"]*)"/u.exec(attributes);
    if (!idMatch) continue;
    const text = htmlToText(inner);
    const textWithoutCode = htmlToTextWithoutCode(inner);
    headings.push({
      level: Number(level),
      id: idMatch[1],
      text,
      legacySlugs: new Set([slugifyHeading(text), slugifyHeading(textWithoutCode)]),
    });
  }
  return headings;
}

/**
 * The layout's page title: the first `h1` **without** an `id`. The `id` is what
 * separates it from a body heading — `content/docs/reference/**` opens each
 * symbol with a level-1 markdown heading, and those get slugged ids like any
 * other heading, while the title comes from frontmatter and gets none.
 */
function extractTitle(html) {
  for (const match of html.matchAll(HEADING_RE)) {
    const [, level, attributes, inner] = match;
    if (level !== "1" || /\sid="/u.test(attributes)) continue;
    const text = htmlToText(inner);
    return { text, legacySlugs: new Set([slugifyHeading(text), slugifyHeading(htmlToTextWithoutCode(inner))]) };
  }
  return null;
}

function matchesLegacySlug(candidate, anchor) {
  if (candidate.legacySlugs.has(anchor)) return true;
  // Duplicate-heading counters are not comparable across the two sluggers (the
  // old reference pages shared one slugger across a whole package), so they are
  // stripped from both sides before matching.
  const base = withoutDedupCounter(anchor);
  for (const slug of candidate.legacySlugs) {
    if (withoutDedupCounter(slug) === base) return true;
  }
  return false;
}

async function resolvePage(baseUrl, path) {
  const chain = [];
  let current = path;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await fetch(`${baseUrl}${current}`, { redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) {
        return { status: response.status, chain, finalPath: current, html: null, error: "3xx with no Location header" };
      }
      chain.push({ from: current, status: response.status, to: location });
      current = location.startsWith("http")
        ? new URL(location).pathname + new URL(location).search
        : location;
      continue;
    }
    const html = response.status === 200 ? await response.text() : null;
    return { status: response.status, chain, finalPath: current, html };
  }
  return { status: 508, chain, finalPath: current, html: null, error: `more than ${MAX_REDIRECT_HOPS} redirect hops` };
}

/**
 * The section-root redirects point at "the first page of the section". That is a
 * fact about `meta.json`, not a constant, so it is re-derived here (descending
 * into subdirectories, since `/docs/reference`'s first entry is a package
 * folder): a reordering that leaves `lib/docs-redirects.mjs` stale must fail CI
 * rather than quietly redirect readers into the middle of a section.
 */
function firstPageOf(dir) {
  const metaPath = join(CONTENT_ROOT, dir, "meta.json");
  if (!existsSync(metaPath)) return { error: `no ${dir}/meta.json to derive the first page from` };
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const pages = Array.isArray(meta.pages) ? meta.pages : [];
  // Skip fumadocs separators (`---Label---`), catch-alls (`...`) and link
  // entries (`[Label](/href)`); the first survivor is the landing entry.
  const first = pages.find((entry) => typeof entry === "string" && !/^(---|\.\.\.|\[)/u.test(entry));
  if (!first) return { error: `${dir}/meta.json has no concrete first page` };
  const asDir = join(CONTENT_ROOT, dir, first);
  if (existsSync(asDir) && existsSync(join(asDir, "meta.json"))) return firstPageOf(join(dir, first));
  return { path: `/docs/${join(dir, first)}` };
}

function checkSectionRootTargets() {
  const problems = [];
  for (const { source, destination, dir } of SECTION_ROOTS) {
    const first = firstPageOf(dir);
    if (first.error) {
      problems.push(`${source}: ${first.error}`);
      continue;
    }
    if (destination !== first.path) {
      problems.push(
        `${source} redirects to ${destination} but the first page of the section is now ${first.path} — update SECTION_ROOTS in lib/docs-redirects.mjs`,
      );
    }
  }
  return problems;
}

function loadAllowlist() {
  if (!existsSync(ALLOWLIST_PATH)) return { entries: [] };
  const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  return { entries: Array.isArray(parsed.entries) ? parsed.entries : [] };
}

function writeAllowlist(drifts) {
  const payload = {
    $comment: [
      "TGEIST-12, gate (d). Anchors that production serves and the new tree renames because",
      "fumadocs slugs headings with github-slugger where the old app used slugifyHeading",
      "(inline code counted, `-+` no longer collapsed, per-page duplicate counters). Every",
      "entry is machine-verified by scripts/check-url-anchor-parity.mjs: the heading must",
      "still exist on the page and must still produce `newAnchor`, so an entry can never hide",
      "a heading that disappeared. A drift that is not listed here fails the gate; an entry",
      "that no longer applies fails as stale. Regenerate with",
      "`node scripts/check-url-anchor-parity.mjs --write-allowlist` and review the diff.",
    ].join(" "),
    entries: drifts
      .map(({ path, prodAnchor, newAnchor, heading }) => ({ path, prodAnchor, newAnchor, heading }))
      .sort((a, b) => a.path.localeCompare(b.path) || a.prodAnchor.localeCompare(b.prodAnchor)),
  };
  writeFileSync(ALLOWLIST_PATH, `${JSON.stringify(payload, null, 2)}\n`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!existsSync(INVENTORY_PATH)) {
    console.error(`✗ gate (d): no frozen inventory at ${INVENTORY_PATH}. This gate has no oracle without it.`);
    process.exit(1);
  }
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
  const pages = Array.isArray(inventory.pages) ? inventory.pages : [];
  if (pages.length === 0) {
    console.error("✗ gate (d): docs/url-inventory.json lists no pages. Refusing to pass a gate that checked nothing.");
    process.exit(1);
  }

  let server = null;
  let baseUrl = options.baseUrl;
  if (!baseUrl) {
    server = await startServer();
    baseUrl = server.baseUrl;
  }

  const results = [];
  try {
    for (const page of pages) {
      const resolved = await resolvePage(baseUrl, page.path);
      const frozenAnchors = Array.isArray(page.anchors) ? page.anchors : [];
      const entry = {
        path: page.path,
        status: resolved.status,
        via: resolved.chain.length > 0 ? resolved.chain.map((hop) => `${hop.status} → ${hop.to}`).join(" ") : null,
        finalPath: resolved.finalPath,
        frozenAnchors: frozenAnchors.length,
        /** anchors resolved as the page's own title */
        titleAnchors: [],
        /** anchors whose heading is still there under a new id */
        drifts: [],
        /** anchors with no heading behind them at all — the real failures */
        lostAnchors: [],
        /**
         * Ids of the headings the page really renders. Written to the `--json`
         * report so `check-doc-links.mjs` can validate every `#fragment` in the
         * corpus against ids observed in HTML instead of reimplementing
         * github-slugger and hoping the reimplementation agrees.
         */
        headingIds: [],
        error: resolved.error ?? null,
      };

      if (resolved.status === 200 && resolved.html) {
        const ids = extractIds(resolved.html);
        const title = extractTitle(resolved.html);
        const headings = extractHeadings(resolved.html);
        entry.headingIds = headings.map((heading) => heading.id);
        for (const anchor of frozenAnchors) {
          if (ids.has(anchor)) continue;
          if (title && matchesLegacySlug(title, anchor)) {
            entry.titleAnchors.push(anchor);
            continue;
          }
          const heading = headings.find((candidate) => matchesLegacySlug(candidate, anchor));
          if (heading) {
            entry.drifts.push({ path: page.path, prodAnchor: anchor, newAnchor: heading.id, heading: heading.text });
            continue;
          }
          entry.lostAnchors.push(anchor);
        }
      }
      results.push(entry);
    }
  } finally {
    server?.stop();
  }

  const unresolved = results.filter((entry) => entry.status !== 200);
  const viaRedirect = results.filter((entry) => entry.status === 200 && entry.via);
  const direct = results.length - viaRedirect.length - unresolved.length;
  const allDrifts = results.flatMap((entry) => entry.drifts);
  const lost = results.filter((entry) => entry.lostAnchors.length > 0);
  const frozenAnchorCount = results.reduce((sum, entry) => sum + entry.frozenAnchors, 0);
  const titleAnchorCount = results.reduce((sum, entry) => sum + entry.titleAnchors.length, 0);
  const lostAnchorCount = results.reduce((sum, entry) => sum + entry.lostAnchors.length, 0);
  const presentAnchorCount = frozenAnchorCount - titleAnchorCount - allDrifts.length - lostAnchorCount;
  const sectionRootProblems = checkSectionRootTargets();

  if (options.writeAllowlist) {
    writeAllowlist(allDrifts);
    console.log(`wrote ${allDrifts.length} drift entries to ${ALLOWLIST_PATH}`);
  }

  // --- drift bookkeeping: unrecorded, changed and stale entries all fail -----
  const allowlist = loadAllowlist();
  const allowByKey = new Map(allowlist.entries.map((item) => [`${item.path}#${item.prodAnchor}`, item]));
  const seenKeys = new Set();
  const unrecordedDrifts = [];
  const changedDrifts = [];
  for (const drift of allDrifts) {
    const key = `${drift.path}#${drift.prodAnchor}`;
    seenKeys.add(key);
    const recorded = allowByKey.get(key);
    if (!recorded) unrecordedDrifts.push(drift);
    else if (recorded.newAnchor !== drift.newAnchor) changedDrifts.push({ ...drift, recorded: recorded.newAnchor });
  }
  const staleAllowlistEntries = allowlist.entries.filter((item) => !seenKeys.has(`${item.path}#${item.prodAnchor}`));

  console.log(
    `gate (d) · URL + anchor parity vs docs/url-inventory.json (frozen ${inventory.frozenAt ?? "?"} from ${inventory.sourceUrl ?? "?"})`,
  );
  console.log(
    `  URLs    ${results.length - unresolved.length}/${results.length} resolve  (${direct} direct · ${viaRedirect.length} via redirect)`,
  );
  console.log(
    `  anchors ${presentAnchorCount}/${frozenAnchorCount} identical · ${titleAnchorCount} page-title (accepted by rule) · ${allDrifts.length} slugger drift (${allDrifts.length - unrecordedDrifts.length - changedDrifts.length} recorded) · ${lostAnchorCount} lost`,
  );

  if (viaRedirect.length > 0) {
    console.log("\n  resolved via redirect:");
    for (const entry of viaRedirect) console.log(`    ${entry.path}  ${entry.via}`);
  }

  if (options.json) {
    writeFileSync(
      options.json,
      `${JSON.stringify(
        {
          inventory: { frozenAt: inventory.frozenAt, sourceUrl: inventory.sourceUrl, gitSha: inventory.gitSha },
          summary: {
            urls: results.length,
            resolved: results.length - unresolved.length,
            direct,
            viaRedirect: viaRedirect.length,
            anchors: frozenAnchorCount,
            identical: presentAnchorCount,
            titleAnchors: titleAnchorCount,
            drifts: allDrifts.length,
            lost: lostAnchorCount,
          },
          results,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\n  report written to ${options.json}`);
  }

  const failed =
    unresolved.length > 0 ||
    lost.length > 0 ||
    unrecordedDrifts.length > 0 ||
    changedDrifts.length > 0 ||
    staleAllowlistEntries.length > 0 ||
    sectionRootProblems.length > 0;

  if (!failed) {
    console.log(
      `\n✓ gate (d): every URL production serves resolves here, and every anchor it serves is either\n  identical, the page's own title, or a recorded slugger rename whose heading is still present.`,
    );
    return;
  }

  console.error("\n✗ gate (d) FAILED");
  if (unresolved.length > 0) {
    console.error(`\n  ${unresolved.length} URL(s) production serves do NOT resolve here:`);
    for (const entry of unresolved) {
      console.error(
        `    ${entry.path} → ${entry.status}${entry.via ? ` (after ${entry.via})` : ""}${entry.error ? ` [${entry.error}]` : ""}`,
      );
    }
    console.error(
      "\n  Fix by emitting the page into content/docs/**, or — when the URL was deliberately\n  consolidated elsewhere — by adding a redirect to apps/docs-next/lib/docs-redirects.mjs.",
    );
  }
  if (lost.length > 0) {
    console.error(
      `\n  ${lostAnchorCount} anchor(s) production serves have no heading behind them here (CONTENT LOST,\n  not a slug rename — no heading on the page slugs to them under either slugger):`,
    );
    for (const entry of lost) {
      console.error(`    ${entry.path}: ${entry.lostAnchors.map((anchor) => `#${anchor}`).join(" ")}`);
    }
  }
  if (unrecordedDrifts.length > 0) {
    console.error(
      `\n  ${unrecordedDrifts.length} anchor(s) renamed by the new slugger and NOT recorded in\n  scripts/url-anchor-drift-allowlist.json (the heading is still there, its id changed —\n  every old deep link to it now lands at the top of the page instead of the section):`,
    );
    for (const drift of unrecordedDrifts) {
      console.error(`    ${drift.path}: #${drift.prodAnchor} → #${drift.newAnchor}   (“${drift.heading}”)`);
    }
    console.error(
      "\n  Either restore the id, or accept the rename by running\n  `node scripts/check-url-anchor-parity.mjs --write-allowlist` and committing the diff.",
    );
  }
  if (changedDrifts.length > 0) {
    console.error(`\n  ${changedDrifts.length} recorded drift(s) now point somewhere else:`);
    for (const drift of changedDrifts) {
      console.error(`    ${drift.path}: #${drift.prodAnchor} → #${drift.newAnchor} (recorded: #${drift.recorded})`);
    }
  }
  if (staleAllowlistEntries.length > 0) {
    console.error(
      `\n  ${staleAllowlistEntries.length} stale entr(ies) in scripts/url-anchor-drift-allowlist.json (the drift no longer\n  happens — good news, but the file must not keep pretending it does):`,
    );
    for (const item of staleAllowlistEntries) console.error(`    ${item.path}: #${item.prodAnchor}`);
  }
  if (sectionRootProblems.length > 0) {
    console.error("\n  section-root redirects out of sync with content/docs/**/meta.json:");
    for (const problem of sectionRootProblems) console.error(`    ${problem}`);
  }
  process.exit(1);
}

main().catch((error) => {
  console.error("gate (d) crashed:", error);
  process.exit(1);
});
