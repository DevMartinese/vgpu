// Third-party and workspace WGSL packages: a user publishes a package whose `exports` map points at
// `.wgsl` files, installs it like any other dependency, and imports it from a shader. Each test below
// builds the *real* on-disk layout a package manager produces (npm hoisting, pnpm's symlinked
// isolated store, a pnpm workspace) rather than a hand-rolled node_modules, because the layout is
// exactly what the resolver's walk is sensitive to.
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";

const NOISE = "export fn customNoise(p: vec2f) -> f32 { return fract(sin(p.x) * 43758.5453); }";
const NOISE_PKG = { name: "@acme/shaders", version: "1.0.0", exports: { "./noise": "./src/noise.wgsl", "./shaders/*": "./src/*.wgsl" } };

test("an npm-hoisted third-party package resolves through its exports map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-3p-npm-"));
  await writePackage(join(dir, "node_modules", "@acme", "shaders"), NOISE_PKG, { "src/noise.wgsl": NOISE });
  const entry = await writeEntry(join(dir, "shaders"), "@acme/shaders/noise", "customNoise");

  const result = await resolveShader({ entry, validate: false });

  expect(result.wgsl).toContain("customNoise");
  expect(deps(result)).toContain("node_modules/@acme/shaders/src/noise.wgsl");
});

test("a wildcard exports subpath resolves for a third-party package", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-3p-star-"));
  await writePackage(join(dir, "node_modules", "@acme", "shaders"), NOISE_PKG, { "src/noise.wgsl": NOISE });
  const entry = await writeEntry(join(dir, "shaders"), "@acme/shaders/shaders/noise", "customNoise");

  expect((await resolveShader({ entry, validate: false })).wgsl).toContain("customNoise");
});

// pnpm never hoists: `node_modules/@acme/shaders` is a symlink into the isolated store.
test("a pnpm-installed third-party package resolves through its store symlink", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-3p-pnpm-"));
  await storePackage(dir, "@acme/shaders", NOISE_PKG, { "src/noise.wgsl": NOISE }, { link: true });
  const entry = await writeEntry(join(dir, "shaders"), "@acme/shaders/noise", "customNoise");

  expect((await resolveShader({ entry, validate: false })).wgsl).toContain("customNoise");
});

// The layout the feature request describes: `import { customNoise } from "@packages/shaders"` where
// `@packages/shaders` is a workspace package linked into the app by `workspace:*`.
test("a workspace package linked by workspace:* resolves from an app shader", async () => {
  const { web } = await workspaceFixture();
  const entry = await writeEntry(join(web, "shaders"), "@packages/shaders", "customNoise");

  const result = await resolveShader({ entry, validate: false });

  expect(result.wgsl).toContain("customNoise");
  expect(deps(result)).toContain("packages/shaders/src/index.wgsl");
});

// A workspace shader package that imports a second workspace package: resolution has to follow a
// symlink (app -> packages/shaders) and then a second one (packages/shaders -> packages/utils).
test("a workspace package's own workspace dependency resolves", async () => {
  const { repo, web } = await workspaceFixture();
  await writePackage(join(repo, "packages", "utils"), { name: "@packages/utils", exports: { ".": "./src/index.wgsl" } }, { "src/index.wgsl": "export fn utilGain() -> f32 { return 2.0; }" });
  await mkdir(join(repo, "packages", "shaders", "node_modules", "@packages"), { recursive: true });
  await symlink(join(repo, "packages", "utils"), join(repo, "packages", "shaders", "node_modules", "@packages", "utils"), "dir");
  await writeFile(join(repo, "packages", "shaders", "src", "index.wgsl"), `import { utilGain } from '@packages/utils';\n${NOISE.replace("p.x", "p.x * utilGain()")}`);
  const entry = await writeEntry(join(web, "shaders"), "@packages/shaders", "customNoise");

  const result = await resolveShader({ entry, validate: false });

  expect(result.wgsl).toContain("utilGain");
  expect(deps(result)).toContain("packages/utils/src/index.wgsl");
});

// Regression: a third-party WGSL package that imports *another* WGSL package. Under pnpm the
// importing shader lives inside the isolated store, and its dependency is installed next to that
// store entry — invisible to a walk that follows the symlinked path, which is why this failed with
// VGPU-WGSL-PKG-NOTFOUND before the walk started resolving the importer's real path.
test("a third-party package's own WGSL dependency resolves from inside pnpm's isolated store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-3p-nested-"));
  const store = await storePackage(dir, "@acme/fbm", { name: "@acme/fbm", exports: { "./fbm": "./src/fbm.wgsl" } }, { "src/fbm.wgsl": "import { customNoise } from '@acme/shaders/noise';\nexport fn acmeFbm(p: vec2f) -> f32 { return customNoise(p) * 0.5; }" }, { link: true });
  // Sibling of the store entry, exactly where pnpm puts a dependency of `@acme/fbm`. It is *not* a
  // direct dependency of the app, so it is absent from the app's own node_modules.
  await writePackage(join(store, "@acme", "shaders"), NOISE_PKG, { "src/noise.wgsl": NOISE });
  const entry = await writeEntry(join(dir, "shaders"), "@acme/fbm/fbm", "acmeFbm");

  const result = await resolveShader({ entry, validate: false });

  expect(result.wgsl).toContain("customNoise");
  expect(deps(result)).toContain(".pnpm/@acme+fbm@1.0.0/node_modules/@acme/shaders/src/noise.wgsl");
});

test("a third-party package with no WGSL export for the subpath reports the exports map", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-3p-sub-"));
  await writePackage(join(dir, "node_modules", "@acme", "shaders"), NOISE_PKG, { "src/noise.wgsl": NOISE });
  const entry = await writeEntry(join(dir, "shaders"), "@acme/shaders/fbm", "customNoise");

  await expect(resolveShader({ entry, validate: false })).rejects.toMatchObject({
    code: "VGPU-WGSL-PKG-NOTFOUND",
    message: "Package export ./fbm was not found in @acme/shaders. Check the package's exports map or fix the import subpath",
  });
});

// Yarn PnP keeps packages in zip archives with no node_modules directories, so the walk can never
// see them; the resolver falls back to Node resolution *from the importing shader* instead. Under PnP
// that hits Yarn's resolver (and its patched `fs` makes the zip-internal path readable). There is no
// PnP install here, so this asserts the wiring: the fallback is gated on `process.versions.pnp` and
// resolves what the walk deliberately refuses to reach (a package above the workspace root).
const pnpDescriptor = Object.getOwnPropertyDescriptor(process.versions, "pnp");
afterEach(() => { if (pnpDescriptor) Object.defineProperty(process.versions, "pnp", pnpDescriptor); else delete (process.versions as { pnp?: string }).pnp; });

test("outside Yarn PnP a package the walk cannot reach stays unresolved", async () => {
  const entry = await aboveWorkspaceRootFixture();

  await expect(resolveShader({ entry, validate: false })).rejects.toMatchObject({ code: "VGPU-WGSL-PKG-NOTFOUND" });
});

test("under Yarn PnP the importing shader's own resolver is used", async () => {
  const entry = await aboveWorkspaceRootFixture();
  Object.defineProperty(process.versions, "pnp", { value: "3", configurable: true });

  expect((await resolveShader({ entry, validate: false })).wgsl).toContain("customNoise");
});

/** App shader in a project whose workspace root shadows the node_modules holding the package: only Node resolution from the importer reaches it. */
async function aboveWorkspaceRootFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-3p-pnp-"));
  await writePackage(join(dir, "node_modules", "@acme", "shaders"), NOISE_PKG, { "src/noise.wgsl": NOISE });
  await mkdir(join(dir, "repo"), { recursive: true });
  await writeFile(join(dir, "repo", "pnpm-workspace.yaml"), "packages: []");
  return await writeEntry(join(dir, "repo", "app"), "@acme/shaders/noise", "customNoise");
}

/** pnpm workspace: `apps/web` depends on `packages/shaders` via a `workspace:*` symlink. */
async function workspaceFixture(): Promise<{ readonly repo: string; readonly web: string }> {
  const repo = await mkdtemp(join(tmpdir(), "vgsl-3p-ws-"));
  await writeFile(join(repo, "pnpm-workspace.yaml"), "packages:\n  - \"apps/*\"\n  - \"packages/*\"\n");
  await writePackage(join(repo, "packages", "shaders"), { name: "@packages/shaders", exports: { ".": "./src/index.wgsl" } }, { "src/index.wgsl": NOISE });
  const web = join(repo, "apps", "web");
  await mkdir(join(web, "node_modules", "@packages"), { recursive: true });
  await writeFile(join(web, "package.json"), JSON.stringify({ name: "web", dependencies: { "@packages/shaders": "workspace:*" } }));
  await symlink(join(repo, "packages", "shaders"), join(web, "node_modules", "@packages", "shaders"), "dir");
  return { repo, web };
}

/** Installs `pkg` into pnpm's virtual store, optionally linking it into the project's node_modules as a direct dependency. Returns the store's node_modules directory, where the package's own dependencies go. */
async function storePackage(root: string, name: string, pkg: object, files: Record<string, string>, opts: { readonly link?: boolean } = {}): Promise<string> {
  const store = join(root, "node_modules", ".pnpm", `${name.replace("/", "+")}@1.0.0`, "node_modules");
  await writePackage(join(store, name), pkg, files);
  if (opts.link) {
    await mkdir(join(root, "node_modules", name.split("/")[0]!), { recursive: true });
    await symlink(join(store, name), join(root, "node_modules", name), "dir");
  }
  return store;
}

async function writePackage(dir: string, pkg: object, files: Record<string, string>): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg));
  for (const [file, text] of Object.entries(files)) {
    await mkdir(join(dir, ...file.split("/").slice(0, -1)), { recursive: true });
    await writeFile(join(dir, ...file.split("/")), text);
  }
}

async function writeEntry(dir: string, spec: string, symbol: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const entry = join(dir, "main.wgsl");
  await writeFile(entry, `import { ${symbol} } from '${spec}';\n@compute @workgroup_size(1) fn main() { let v = ${symbol}(vec2f(1.0)); }`);
  return entry;
}

function deps(result: { readonly deps: readonly string[] }): string {
  return result.deps.map((dep) => dep.replace(/\\/gu, "/")).join("\n");
}
