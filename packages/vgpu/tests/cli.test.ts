import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { runCli } from "../bin/vgpu.js";

const packageVersion = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

function success(args) {
  const result = runCli(args);
  expect(result.code).toBe(0);
  expect(result.stderr).toBeUndefined();
  return result.stdout ?? "";
}

const routerHelp = `vgpu ${packageVersion}

TypeScript library for WebGPU: typed shader imports, a tiny gpu-first API, and
the same code running in the browser, headless Node, and your test suite.

## Read the docs
  npx vgpu docs cat getting-started.md    The guide for using the current API correctly
  npx vgpu docs find "<topic | symbol | VGPU-error-code>"
  npx vgpu docs cat <path>

## Validate shader code
  npx vgpu check <file.wgsl>              Validate and reflect a WGSL file as JSON

## Working examples
  npx vgpu examples search "<topic>"
  npx vgpu examples pull <slug> --out <dir>

## Node rendering environment
  npx vgpu doctor
`;

test("routes the bare command and --help/-h to the docs-first guide, exit 0", () => {
  expect(runCli([])).toMatchObject({ code: 0, stdout: routerHelp });
  expect(runCli(["--help"])).toMatchObject({ code: 0, stdout: routerHelp });
  expect(runCli(["-h"])).toMatchObject({ code: 0, stdout: routerHelp });
  expect(success(["--version"])).toBe(`${packageVersion}\n`);
});

test("does not list snapshot/install-dawn/install-software-renderer in the router (still runnable)", async () => {
  const help = success(["--help"]);
  expect(help).not.toContain("snapshot");
  expect(help).not.toContain("install-dawn");
  expect(help).not.toContain("install-software-renderer");
  await expect(Promise.resolve(runCli(["install-dawn", "--help"]))).resolves.toMatchObject({ code: 0 });
  await expect(Promise.resolve(runCli(["install-software-renderer", "--help"]))).resolves.toMatchObject({ code: 0 });
});

test("routes an unknown command to the same guide with exit code 2", () => {
  const result = runCli(["nope"]);
  expect(result.code).toBe(2);
  expect(result.stderr).toBe(`Unknown command: nope\n\n${routerHelp}`);
});

test("exposes doctor JSON without rendering", async () => {
  const result = await runCli(["doctor", "--no-render"]);
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout ?? "")).toMatchObject({ verdict: "unverified", adapter: null, findings: expect.any(Array) });
});

test("exposes the manual native installers", async () => {
  await expect(Promise.resolve(runCli(["install-dawn", "--help"]))).resolves.toMatchObject({
    code: 0,
    stdout: expect.stringContaining("VGPU_CACHE_DIR"),
  });
  await expect(Promise.resolve(runCli(["install-software-renderer", "--help"]))).resolves.toMatchObject({
    code: 0,
    stdout: expect.stringContaining("sha256-verify"),
  });
});

test("puts the getting-started guide first in CLI help", () => {
  const rootHelp = success(["--help"]);
  expect(rootHelp.indexOf("npx vgpu docs cat getting-started.md")).toBeLessThan(rootHelp.indexOf("## Validate shader code"));

  const help = success(["docs", "help"]);
  expect(help).toContain("Usage: vgpu docs <command>");
  expect(help.split("\n")[2]).toBe("Start here: vgpu docs cat getting-started.md   (the guide for using the latest API correctly)");
  expect(help.indexOf("vgpu docs cat getting-started.md", help.indexOf("Examples:"))).toBeLessThan(help.indexOf("vgpu docs ls /guides"));
});

test("curates root and guide listings for onboarding", () => {
  const root = success(["docs", "ls"]).trimEnd().split("\n");
  expect(root.slice(0, 4)).toEqual(["/guides", "/vgpu", "/vgpu/scene", "/vgpu/core"]);
  expect(root.at(-1)).toBe("Tip: start with \"vgpu docs cat getting-started.md\"; /guides holds concept guides; @vgpu/render/* is low-level tooling.");
  expect(root.indexOf("/@vgpu/wgsl")).toBeLessThan(root.indexOf("/@vgpu/render/edit"));

  const guides = success(["docs", "ls", "/guides"]).trimEnd().split("\n");
  expect(guides[0]).toBe("getting-started.docs.md");
  expect(guides.slice(1, 8)).toEqual([
    "concepts-context.docs.md",
    "concepts-draws.docs.md",
    "concepts-compilation.docs.md",
    "concepts-effects.docs.md",
    "concepts-passes.docs.md",
    "concepts-frames.docs.md",
    "concepts-render-bundles.docs.md",
  ]);

  expect(success(["docs", "ls", "/vgpu/core"])).toContain("buffer.docs.md");
});

test("cats docs by path and unique symbol", () => {
  expect(success(["docs", "cat", "/vgpu/core/buffer.docs.md"])).toContain("# Buffer");
  expect(success(["docs", "cat", "Buffer"])).toContain("# Buffer");
});

test("cats getting-started guide from forgiving guide names", () => {
  const acceptedForms = [
    "getting-started",
    "getting-started.md",
    "getting-started.docs.md",
    "/guides/getting-started.docs.md",
    "/guides/getting-started.md",
    "guides/getting-started.docs.md",
    "guides/getting-started.md",
  ];

  for (const form of acceptedForms) {
    const output = success(["docs", "cat", form]);
    expect(output).toContain("# Getting started");
    expect(output).toContain("vgpu docs cat browser-testing");
  }
});

test("greps content with case and package options", () => {
  expect(success(["docs", "grep", "uniforms(gpu"])).toContain("uniforms(gpu");
  expect(runCli(["docs", "grep", "UNIFORMS(GPU"]).code).toBe(1);
  const filtered = success(["docs", "grep", "-i", "--package", "@vgpu/wgsl", "MINIFY"]);
  expect(filtered).toContain("/@vgpu/wgsl/");
});

test("finds symbols and resolves paths", () => {
  expect(success(["docs", "find", "Buffer"])).toContain("Buffer\tvgpu/core");
  expect(success(["docs", "path", "Buffer"])).toBe("/vgpu/core/buffer.docs.md\n");
  expect(success(["docs", "path", "/vgpu/core/buffer.docs.md"])).toBe("/vgpu/core/buffer.docs.md\n");
  expect(success(["docs", "path", "getting-started"])).toBe("/guides/getting-started.docs.md\n");
  expect(success(["docs", "path", "getting-started.md"])).toBe("/guides/getting-started.docs.md\n");
  expect(success(["docs", "path", "/guides/performance-model.docs.md"])).toBe("/guides/performance-model.docs.md\n");
});

test("keeps existing guide and API docs forms working", () => {
  expect(success(["docs", "cat", "browser-testing"])).toContain("# Browser testing with Playwright WebGPU");
  expect(success(["docs", "cat", "performance-model"])).toContain("# Performance model");
  expect(success(["docs", "cat", "/guides/performance-model.docs.md"])).toContain("# Performance model");
  expect(success(["docs", "cat", "Buffer"])).toContain("# Buffer");
  expect(success(["docs", "cat", "/vgpu/core/buffer.docs.md"])).toContain("# Buffer");
});

test("returns nonzero for missing and unknown docs commands", () => {
  expect(runCli(["docs", "cat", "MissingSymbol"])).toMatchObject({ code: 1, stderr: expect.stringContaining("Symbol not found") });
  expect(runCli(["docs", "nope"])).toMatchObject({ code: 1, stderr: expect.stringContaining("Unknown docs command") });
  expect(runCli(["nope"])).toMatchObject({ code: 2, stderr: expect.stringContaining("Unknown command: nope") });
});


test.skipIf(process.env.VGPU_DOCKER_TEST === "1")("snapshot command requires the Docker GPU harness", async () => {
  await expect(Promise.resolve(runCli(["snapshot", "--ci"]))).resolves.toMatchObject({
    code: 1,
    stderr: expect.stringContaining("VGPU_DOCKER_TEST=1"),
  });
});
