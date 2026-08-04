/**
 * TGEIST-13 — tests for the G4 deployment parity verifier.
 *
 * The interesting half is not the pure helpers: it is that the crawler actually catches a
 * deployment that serves ALMOST the right tree. So most of these tests boot a real HTTP server on
 * 127.0.0.1 that replays the committed artifact tree with the same headers the Next route handlers
 * produce, and then break exactly one thing at a time (one flipped byte, one wrong content-type, a
 * missing object, a stale index) and assert the verdict turns red for the right reason.
 *
 * No network egress: every request goes to the loopback server, and the A/B mode is exercised by
 * running two of them.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
// @ts-expect-error -- dependency-free .mjs script, intentionally untyped (see the file header).
import * as verifier from "./verify-examples-api-deployment.mjs";

const {
  DISCOVERY_ARTIFACT_KEY,
  LATEST_ARTIFACT_KEY,
  IMMUTABLE_CACHE_CONTROL,
  MUTABLE_CACHE_CONTROL,
  artifactKind,
  artifactPathForKey,
  backoffDelayMs,
  compareReports,
  detectBlock,
  expectedCacheControl,
  expectedContentType,
  formatReport,
  isRetriableStatus,
  keyForArtifactPath,
  normalizeBaseUrl,
  normalizeEtag,
  parseArguments,
  verifyDeployment,
} = verifier;

const repoRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const treeRoot = join(repoRoot, "apps/docs/generated/examples-api");

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test("artifact keys map to the paths the two route groups actually serve", () => {
  expect(artifactPathForKey(DISCOVERY_ARTIFACT_KEY)).toBe("/.well-known/vgpu-examples.json");
  expect(artifactPathForKey(LATEST_ARTIFACT_KEY)).toBe("/api/examples/v1/latest.json");
  expect(artifactPathForKey("examples/v1/revisions/abc/index.json")).toBe("/api/examples/v1/revisions/abc/index.json");
  expect(keyForArtifactPath("/.well-known/vgpu-examples.json")).toBe(DISCOVERY_ARTIFACT_KEY);
  expect(keyForArtifactPath("/api/examples/v1/latest.json")).toBe(LATEST_ARTIFACT_KEY);
  expect(keyForArtifactPath("/docs/examples")).toBeUndefined();
});

test("content-type expectation mirrors withCharset in artifact-store.ts", () => {
  expect(expectedContentType("text/wgsl")).toBe("text/wgsl; charset=utf-8");
  expect(expectedContentType("text/typescript")).toBe("text/typescript; charset=utf-8");
  expect(expectedContentType("application/json; charset=utf-8")).toBe("application/json; charset=utf-8");
  expect(expectedContentType("text/plain; charset=utf-8")).toBe("text/plain; charset=utf-8");
});

test("only the two mutable artifacts get the revalidating cache-control", () => {
  expect(expectedCacheControl(DISCOVERY_ARTIFACT_KEY)).toBe(MUTABLE_CACHE_CONTROL);
  expect(expectedCacheControl(LATEST_ARTIFACT_KEY)).toBe(MUTABLE_CACHE_CONTROL);
  expect(expectedCacheControl("examples/v1/revisions/abc/index.json")).toBe(IMMUTABLE_CACHE_CONTROL);
});

test("artifact kinds classify the whole tree", () => {
  expect(artifactKind(DISCOVERY_ARTIFACT_KEY)).toBe("discovery");
  expect(artifactKind(LATEST_ARTIFACT_KEY)).toBe("latest");
  expect(artifactKind("examples/v1/revisions/a/revision.json")).toBe("revision");
  expect(artifactKind("examples/v1/revisions/a/index.json")).toBe("index");
  expect(artifactKind("examples/v1/revisions/a/examples/gradient/manifest.json")).toBe("manifest");
  expect(artifactKind("examples/v1/revisions/a/examples/gradient/files/shader.wgsl.raw")).toBe("file");
});

test("a weak ETag is not a parity difference", () => {
  expect(normalizeEtag('"abc"')).toBe("abc");
  expect(normalizeEtag('W/"abc"')).toBe("abc");
  expect(normalizeEtag(undefined)).toBeUndefined();
});

test("base URLs are normalised, and nonsense is rejected", () => {
  expect(normalizeBaseUrl("vgpu.sh")).toBe("https://vgpu.sh");
  expect(normalizeBaseUrl("https://vgpu.sh/")).toBe("https://vgpu.sh");
  expect(normalizeBaseUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
  expect(() => normalizeBaseUrl("https://vgpu.sh/?x=1")).toThrow(/query or hash/);
  expect(() => normalizeBaseUrl("not a url")).toThrow(/Invalid deployment URL/);
});

test("Vercel bot mitigation and deployment protection are blocks, not parity failures", () => {
  expect(detectBlock(403, new Headers({ "x-vercel-mitigated": "challenge" }))).toMatchObject({
    blocked: true,
    reason: "bot-mitigation",
  });
  expect(detectBlock(401, new Headers({ "content-type": "text/html" }))).toMatchObject({
    blocked: true,
    reason: "deployment-protection",
  });
  expect(detectBlock(403, new Headers({ "content-type": "text/html; charset=utf-8" }))).toMatchObject({ blocked: true });
  // A 404 or a 500 from the route itself IS a real failure and must stay one.
  expect(detectBlock(404, new Headers({ "content-type": "application/json" })).blocked).toBe(false);
  expect(detectBlock(500, new Headers()).blocked).toBe(false);
});

test("transient statuses are retried, permanent ones are not", () => {
  expect([408, 429, 500, 502, 503].every(isRetriableStatus)).toBe(true);
  expect([200, 304, 400, 404].some(isRetriableStatus)).toBe(false);
  expect(backoffDelayMs(0)).toBe(500);
  expect(backoffDelayMs(3)).toBe(4000);
  expect(backoffDelayMs(10)).toBe(8000);
});

test("argument parsing covers the single, A/B and local-cross-check shapes", () => {
  expect(parseArguments(["https://vgpu.sh"]).urls).toEqual(["https://vgpu.sh"]);
  expect(parseArguments(["vgpu.sh", "docs-next.vercel.app"]).urls).toEqual([
    "https://vgpu.sh",
    "https://docs-next.vercel.app",
  ]);
  expect(parseArguments(["vgpu.sh", "--compare", "docs-next.vercel.app"]).urls).toHaveLength(2);
  expect(parseArguments(["vgpu.sh", "--local"]).localTree).toBe("apps/docs/generated/examples-api");
  expect(parseArguments(["vgpu.sh", "--local=apps/docs-next/generated/examples-api"]).localTree).toBe(
    "apps/docs-next/generated/examples-api",
  );
  expect(parseArguments(["vgpu.sh", "--require-local"]).requireLocal).toBe(true);
  expect(parseArguments(["vgpu.sh", "--concurrency", "3", "--timeout", "1000", "--retries", "0"])).toMatchObject({
    concurrency: 3,
    timeoutMs: 1000,
    retries: 0,
  });
  expect(() => parseArguments([])).toThrow(/Missing <baseUrl>/);
  expect(() => parseArguments(["a", "b", "c"])).toThrow(/At most two/);
  expect(() => parseArguments(["vgpu.sh", "vgpu.sh"])).toThrow(/two different/);
  expect(() => parseArguments(["--nope"])).toThrow(/Unknown option/);
});

test("compareReports ignores baseUrl and timings but not bytes", () => {
  const artifact = {
    key: "examples/v1/latest.json",
    kind: "latest",
    status: 200,
    contentType: "application/json; charset=utf-8",
    contentLength: 10,
    bytes: 10,
    sha256: "a".repeat(64),
    etag: "a".repeat(64),
    cacheControl: MUTABLE_CACHE_CONTROL,
    ok: true,
  };
  const a = { baseUrl: "https://vgpu.sh", revision: "r", durationMs: 1, artifacts: [artifact] };
  const b = { baseUrl: "https://preview.vercel.app", revision: "r", durationMs: 999, artifacts: [{ ...artifact }] };
  expect(compareReports(a, b)).toEqual({ equal: true, differences: [] });

  const drifted = { ...b, artifacts: [{ ...artifact, sha256: "b".repeat(64) }] };
  expect(compareReports(a, drifted).equal).toBe(false);
  expect(compareReports(a, drifted).differences[0]).toMatchObject({ scope: "artifact", field: "sha256" });

  expect(compareReports(a, { ...b, revision: "other" }).differences[0]).toMatchObject({ scope: "revision" });
  expect(compareReports(a, { ...b, artifacts: [] }).differences[0]).toMatchObject({ scope: "missing-in-b" });
});

// ---------------------------------------------------------------------------
// Full-tree crawl against a replay of the committed artifact tree
// ---------------------------------------------------------------------------

type Mutation = (key: string, bytes: Buffer) => { bytes?: Buffer; contentType?: string; status?: number } | undefined;

function loadTree(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const walk = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory)) {
      const absolute = join(directory, entry);
      const key = prefix ? `${prefix}/${entry}` : entry;
      if (statSync(absolute).isDirectory()) walk(absolute, key);
      else files.set(key, readFileSync(absolute));
    }
  };
  walk(treeRoot, "");
  return files;
}

const tree = loadTree();

function contentTypeFor(key: string): string {
  if (key.endsWith(".json")) return "application/json; charset=utf-8";
  if (key.endsWith(".wgsl.raw")) return "text/wgsl; charset=utf-8";
  return "text/typescript; charset=utf-8";
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

/** Serves the committed tree exactly like the Next route handlers do (headers included). */
async function startReplayServer(mutate?: Mutation): Promise<string> {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const key = keyForArtifactPath(path);
    const original = key ? tree.get(key) : undefined;
    if (!key || !original) {
      response.writeHead(404, { "content-type": "application/json; charset=utf-8" }).end("{}");
      return;
    }
    const override = mutate?.(key, original) ?? {};
    const bytes = override.bytes ?? original;
    if (override.status && override.status !== 200) {
      response.writeHead(override.status, { "content-type": "application/json; charset=utf-8" }).end("{}");
      return;
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const headers: Record<string, string> = {
      "access-control-allow-origin": "*",
      "x-content-type-options": "nosniff",
      "cache-control": expectedCacheControl(key),
      "content-type": override.contentType ?? contentTypeFor(key),
      etag: `"${digest}"`,
    };
    if (request.headers["if-none-match"] === `"${digest}"`) {
      response.writeHead(304, headers).end();
      return;
    }
    headers["content-length"] = String(bytes.byteLength);
    response.writeHead(200, headers).end(request.method === "HEAD" ? undefined : bytes);
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const runOptions = { concurrency: 16, retries: 0, timeoutMs: 10_000 };

test("a faithful deployment verifies green over the whole tree", async () => {
  const baseUrl = await startReplayServer();
  const report = await verifyDeployment(baseUrl, runOptions);
  expect(report.problems).toEqual([]);
  expect(report.artifacts.filter((artifact: { ok: boolean }) => !artifact.ok)).toEqual([]);
  // The whole committed tree, not just the three artifacts the generator's own hook checks.
  expect(report.counts.total).toBe(tree.size);
  expect(report.counts.byKind).toMatchObject({ discovery: 1, latest: 1, revision: 1, index: 1 });
  expect(report.ok).toBe(true);
  expect(formatReport(report)).toContain("verdict    PASS");
}, 60_000);

test("one flipped byte in one source file turns the verdict red", async () => {
  const target = [...tree.keys()].find((key) => key.endsWith("shader.wgsl.raw"))!;
  const baseUrl = await startReplayServer((key, bytes) =>
    key === target ? { bytes: Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from("X")]) } : undefined,
  );
  const report = await verifyDeployment(baseUrl, runOptions);
  expect(report.ok).toBe(false);
  const failed = report.artifacts.filter((artifact: { ok: boolean }) => !artifact.ok);
  expect(failed).toHaveLength(1);
  expect(failed[0].key).toBe(target);
  expect(failed[0].problems.join(" ")).toMatch(/sha256 .* != declared/);
}, 60_000);

test("a wrong content-type on a source file is caught even when the bytes are right", async () => {
  const target = [...tree.keys()].find((key) => key.endsWith("shader.wgsl.raw"))!;
  const baseUrl = await startReplayServer((key) => (key === target ? { contentType: "text/plain; charset=utf-8" } : undefined));
  const report = await verifyDeployment(baseUrl, runOptions);
  expect(report.ok).toBe(false);
  expect(report.artifacts.find((artifact: { key: string }) => artifact.key === target).problems.join(" ")).toMatch(
    /content-type .*text\/plain/,
  );
}, 60_000);

test("an artifact missing from the deployment is a failure, not a silently shorter tree", async () => {
  const target = [...tree.keys()].find((key) => key.endsWith("manifest.json"))!;
  const baseUrl = await startReplayServer((key) => (key === target ? { status: 404 } : undefined));
  const report = await verifyDeployment(baseUrl, runOptions);
  expect(report.ok).toBe(false);
  expect(report.artifacts.find((artifact: { key: string }) => artifact.key === target).problems.join(" ")).toMatch(
    /expected HTTP 200, got 404/,
  );
}, 60_000);

test("a latest pointer aimed at a revision the deployment does not carry is caught", async () => {
  const stale = "0".repeat(64);
  const baseUrl = await startReplayServer((key, bytes) =>
    key === LATEST_ARTIFACT_KEY
      ? {
          bytes: Buffer.from(
            JSON.stringify({
              ...JSON.parse(bytes.toString("utf8")),
              revision: stale,
              indexUrl: `https://vgpu.sh/api/examples/v1/revisions/${stale}/index.json`,
            }),
          ),
        }
      : undefined,
  );
  const report = await verifyDeployment(baseUrl, runOptions);
  expect(report.ok).toBe(false);
  expect(report.revision).toBe(stale);
  expect(JSON.stringify(report)).toMatch(/expected HTTP 200, got 404/);
}, 60_000);

test("A/B parity is green between two identical deployments and red when one drifts", async () => {
  const [a, b] = await Promise.all([startReplayServer(), startReplayServer()]);
  const [reportA, reportB] = [await verifyDeployment(a, runOptions), await verifyDeployment(b, runOptions)];
  expect(compareReports(reportA, reportB)).toEqual({ equal: true, differences: [] });

  const target = [...tree.keys()].find((key) => key.endsWith("shader.wgsl.raw"))!;
  const drifted = await startReplayServer((key, bytes) =>
    key === target ? { bytes: Buffer.concat([bytes, Buffer.from("\n")]) } : undefined,
  );
  const comparison = compareReports(reportA, await verifyDeployment(drifted, runOptions));
  expect(comparison.equal).toBe(false);
  expect(comparison.differences.map((difference: { field?: string }) => difference.field)).toContain("sha256");
}, 120_000);

test("bot mitigation aborts the run as BLOCKED instead of reporting a parity failure", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(403, { "x-vercel-mitigated": "challenge", "content-type": "text/html" }).end("<html>");
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  servers.push(server);
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await expect(verifyDeployment(baseUrl, runOptions)).rejects.toMatchObject({
    name: "BlockedError",
    detail: { reason: "bot-mitigation" },
  });
}, 30_000);
