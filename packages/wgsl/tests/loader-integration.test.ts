import { readFile, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveShader } from "@vgpu/wgsl/runtime";
import { transformWgsl } from "@vgpu/wgsl/loader-vite";
import wgslWebpackLoader from "@vgpu/wgsl/loader-webpack";

test("package exports pattern resolves", async () => {
  const dir = await pkgFixture({ exports: { "./shaders/*": "./dist/*.wgsl" }, files: { "dist/foo.wgsl": "export fn x(){}" } });
  await writeFile(join(dir, "app", "main.wgsl"), "import { x } from 'pkg/shaders/foo'; fn main(){x();}");
  expect((await resolveShader({ entry: join(dir, "app", "main.wgsl"), validate: false })).wgsl).toContain("dist/foo.wgsl");
});
test("walking stops at workspace root", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-"));
  await mkdir(join(dir, "root", "app"), { recursive: true });
  await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(dir, "root", "pnpm-workspace.yaml"), "packages: []");
  await writeFile(join(dir, "root", "app", "main.wgsl"), "import { x } from 'pkg';");
  await writeFile(join(dir, "node_modules", "pkg", "package.json"), JSON.stringify({ exports: { ".": "./index.wgsl" } }));
  await writeFile(join(dir, "node_modules", "pkg", "index.wgsl"), "export fn x(){}");
  await expect(resolveShader({ entry: join(dir, "root", "app", "main.wgsl"), validate: false })).rejects.toMatchObject({ code: "VGPU-WGSL-PKG-NOTFOUND" });
});
// `@vgpu/wgsl-std` reaches a user's project transitively through `vgpu`. Walking up from the shader
// only finds it when the package manager hoists it (npm/yarn-classic); under pnpm's isolated store
// and Yarn PnP it is installed but invisible to that walk, which is the failure a dogfood run hit.
// The shader below sits in a temp dir with no node_modules chain at all, so it can only resolve
// through the fallback that asks Node to resolve the specifier next to the resolver itself.
test("a transitively installed WGSL package resolves from an isolated layout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-isolated-"));
  const entry = join(dir, "main.wgsl");
  await writeFile(entry, "import { voronoi3d } from '@vgpu/wgsl-std/noise';\nfn main(){ let s = voronoi3d(vec3f(1.0)); }");

  const result = await resolveShader({ entry, validate: false });

  expect(result.wgsl).toContain("voronoi3d");
  expect(result.deps.some((dep) => dep.replace(/\\/gu, "/").endsWith("wgsl-std/src/noise/index.wgsl"))).toBe(true);
});

// The fallback that resolves alongside the resolver exists only to rescue `@vgpu/*` transitives in
// isolated layouts (see above). A non-`@vgpu` bare specifier must never ride that fallback, even when
// it happens to be reachable from `@vgpu/wgsl`'s own install location (e.g. one of its
// devDependencies, like `webpack`) — otherwise a typo'd import can silently resolve to an unrelated
// JS file instead of failing with a clear PKG-NOTFOUND.
test("a non-@vgpu specifier reachable only from the resolver's own install location is not resolved", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-isolated-"));
  const entry = join(dir, "main.wgsl");
  await writeFile(entry, "import { thing } from 'webpack'; fn main(){}");

  await expect(resolveShader({ entry, validate: false })).rejects.toMatchObject({
    code: "VGPU-WGSL-PKG-NOTFOUND",
    message: "Package webpack was not found. Install the package (npm install webpack) or check the specifier",
  });
});

test("a project-local copy of a WGSL package wins over the transitive one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-local-wins-"));
  const pkgDir = join(dir, "node_modules", "@vgpu", "wgsl-std");
  await mkdir(pkgDir, { recursive: true });
  await writeFile(join(pkgDir, "package.json"), JSON.stringify({ name: "@vgpu/wgsl-std", exports: { "./noise": "./local.wgsl" } }));
  // A symbol the real package does not export: resolving to the real one would throw SYM-NOEXPORT.
  await writeFile(join(pkgDir, "local.wgsl"), "export fn projectLocalMarker() -> f32 { return 1.0; }");
  const entry = join(dir, "main.wgsl");
  await writeFile(entry, "import { projectLocalMarker } from '@vgpu/wgsl-std/noise';\nfn main(){ let v = projectLocalMarker(); }");

  const result = await resolveShader({ entry, validate: false });

  expect(result.wgsl).toContain("projectLocalMarker");
  expect(result.deps.some((dep) => dep.replace(/\\/gu, "/").includes("vgsl-local-wins-"))).toBe(true);
});

// Uses a package that exists in no layout: `@vgpu/wgsl-std` is now always resolvable, since
// `@vgpu/wgsl` depends on it.
test("uninstalled package error teaches the install fix", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-"));
  await mkdir(join(dir, "app"), { recursive: true });
  const entry = join(dir, "app", "main.wgsl");
  await writeFile(entry, "import { thing } from '@acme/not-installed/noise'; fn main(){}");
  await expect(resolveShader({ entry, validate: false })).rejects.toMatchObject({
    code: "VGPU-WGSL-PKG-NOTFOUND",
    message: "Package @acme/not-installed was not found. Install the package (npm install @acme/not-installed) or check the specifier",
  });
});

test("unknown package export error names the package and points at its exports map", async () => {
  const dir = await pkgFixture({ exports: { "./shaders/*": "./dist/*.wgsl" }, files: { "dist/foo.wgsl": "export fn x(){}" } });
  await writeFile(join(dir, "app", "main.wgsl"), "import { x } from 'pkg/missing'; fn main(){x();}");
  await expect(resolveShader({ entry: join(dir, "app", "main.wgsl"), validate: false })).rejects.toMatchObject({
    code: "VGPU-WGSL-PKG-NOTFOUND",
    message: "Package export ./missing was not found in pkg. Check the package's exports map or fix the import subpath",
  });
});

test("conditional exports select default", async () => {
  const dir = await pkgFixture({ exports: { ".": { import: "./bad.wgsl", default: "./good.wgsl" } }, files: { "good.wgsl": "export fn x(){}" } });
  await writeFile(join(dir, "app", "main.wgsl"), "import { x } from 'pkg'; fn main(){x();}");
  const result = await resolveShader({ entry: join(dir, "app", "main.wgsl"), validate: false });
  expect(result.wgsl).toContain("good.wgsl");
  expect(result.diagnostics).toEqual([expect.objectContaining({ code: "VGPU-WGSL-PKG-CONDITIONAL", severity: "warning" })]);
});
test("leaf loader path is byte-for-byte unchanged when minify is false", async () => {
  const source = "// import { x } from 'y'\n@compute @workgroup_size(1) fn main() {\n  var value = 1u;\n}\n";
  expect(defaultExport(await transformWgsl(source, "/x.wgsl"))).toBe(source);
  expect(defaultExport(wgslWebpackLoader.call({ resourcePath: "/x.wgsl" }, source) ?? "")).toBe(source);
});

test("leaf loader path compacts comments whitespace and safe locals when minify is true", async () => {
  const source = "// leading comment\n@compute @workgroup_size(1) fn main() {\n  /* keep names stable */ var value = 1u;\n}\n";
  const expected = "@compute @workgroup_size(1) fn main(){var a=1u;}";
  expect(defaultExport(await transformWgsl(source, "/x.wgsl", { minify: true }))).toBe(expected);
  expect(defaultExport(wgslWebpackLoader.call({ resourcePath: "/x.wgsl", getOptions: () => ({ minify: true }) }, source) ?? "")).toBe(expected);
});

test("leaf loader path supports object-form whitespace-only minify", async () => {
  const source = "// leading comment\n@compute @workgroup_size(1) fn main() {\n  /* keep names stable */ var value = 1u;\n}\n";
  const expected = "@compute @workgroup_size(1) fn main(){var value=1u;}";
  const minify = { identifiers: "none" } as const;
  expect(defaultExport(await transformWgsl(source, "/x.wgsl", { minify }))).toBe(expected);
  expect(defaultExport(wgslWebpackLoader.call({ resourcePath: "/x.wgsl", getOptions: () => ({ minify }) }, source) ?? "")).toBe(expected);
});

test("loader comment-only import passes through", async () => {
  const code = (await transformWgsl("// import { x } from 'y'", "/x.wgsl")).code;
  expect(code).toContain("version: 1");
  expect(code).toContain("// import");
});
test("loaders resolve top-level import", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-"));
  await writeFile(join(dir, "main.wgsl"), "import { x } from './x.wgsl'; fn main(){x();}");
  await writeFile(join(dir, "x.wgsl"), "export fn x(){}");
  expect((await transformWgsl(await readFile(join(dir, "main.wgsl"), "utf8"), join(dir, "main.wgsl"))).code).toContain("_vgsl_");
  const code = await webpack(join(dir, "main.wgsl"), await readFile(join(dir, "main.wgsl"), "utf8"));
  expect(code).toContain("_vgsl_");
});

test("loaders resolve imports after top-level diagnostic directives", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-"));
  const entry = join(dir, "main.wgsl");
  await writeFile(entry, "diagnostic(off, derivative_uniformity);\nimport { x } from './x.wgsl';\nfn main(){x();}");
  await writeFile(join(dir, "x.wgsl"), "export fn x(){}");
  expect(defaultExport(await transformWgsl(await readFile(entry, "utf8"), entry))).toContain("_vgsl_");
  expect(defaultExport(await webpack(entry, await readFile(entry, "utf8")))).toContain("_vgsl_");
});

test("loaders compact resolved import graphs when minify is true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-"));
  const entry = join(dir, "main.wgsl");
  await writeFile(entry, "import { helper } from './helper.wgsl';\n// entry comment\nfn main(){ helper(); }\n");
  await writeFile(join(dir, "helper.wgsl"), "// helper comment\nexport fn helper(){ }\n");
  const viteWgsl = defaultExport(await transformWgsl(await readFile(entry, "utf8"), entry, { minify: true }));
  expect(viteWgsl).toBe("fn a(){b();}fn b(){}");
  expect(viteWgsl).not.toContain("//");
  expect(viteWgsl).not.toContain("\n");
  const webpackWgsl = defaultExport(await webpack(entry, await readFile(entry, "utf8"), { minify: true }));
  expect(webpackWgsl).toBe(viteWgsl);
});

test("loaders compact resolved import graphs with object-form minify", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-"));
  const entry = join(dir, "main.wgsl");
  await writeFile(entry, "import { helper } from './helper.wgsl';\n// entry comment\nfn main(){ helper(); }\n");
  await writeFile(join(dir, "helper.wgsl"), "// helper comment\nexport fn helper(){ }\n");
  const minify = { whitespace: true, identifiers: "none" } as const;
  const viteWgsl = defaultExport(await transformWgsl(await readFile(entry, "utf8"), entry, { minify }));
  expect(viteWgsl).toContain("fn _vgsl_");
  expect(viteWgsl).toContain("__main(){_vgsl_");
  expect(viteWgsl).not.toContain("//");
  expect(viteWgsl).not.toContain("\n");
  const webpackWgsl = defaultExport(await webpack(entry, await readFile(entry, "utf8"), { minify }));
  expect(webpackWgsl).toBe(viteWgsl);
});

async function pkgFixture(opts: { exports: unknown; files: Record<string, string> }) {
  const dir = await mkdtemp(join(tmpdir(), "vgsl-"));
  await mkdir(join(dir, "app"), { recursive: true });
  await mkdir(join(dir, "node_modules", "pkg"), { recursive: true });
  await writeFile(join(dir, "node_modules", "pkg", "package.json"), JSON.stringify({ name: "pkg", exports: opts.exports }));
  for (const [file, text] of Object.entries(opts.files)) {
    await mkdir(join(dir, "node_modules", "pkg", file.split("/").slice(0, -1).join("/")), { recursive: true });
    await writeFile(join(dir, "node_modules", "pkg", file), text);
  }
  return dir;
}

function defaultExport(codeOrResult: string | { readonly code: string }): string {
  return shaderSource(codeOrResult).wgsl;
}

function shaderSource(codeOrResult: string | { readonly code: string }): { readonly version: 1; readonly wgsl: string } {
  const code = typeof codeOrResult === "string" ? codeOrResult : codeOrResult.code;
  return Function(code.replace(/^export default /, "return ").replace(/;$/, ";"))() as { readonly version: 1; readonly wgsl: string };
}

async function webpack(resourcePath: string, source: string, options: { readonly minify?: boolean | { readonly whitespace?: boolean; readonly identifiers?: "none" | "safe" } } = {}) {
  return new Promise<string>((resolve, reject) => wgslWebpackLoader.call({ resourcePath, getOptions: () => options, async: () => (error, result) => error ? reject(error) : resolve(result ?? "") }, source));
}
