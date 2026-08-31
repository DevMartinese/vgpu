import { describe, expect, it } from "vitest";
import { buildExamplePrompt, buildExampleV0RegistryItem, buildV0OpenUrl } from "./example-actions";
import { getExample } from "./examples-registry";

const gradient = getExample("gradient");
if (!gradient) throw new Error("Missing gradient example fixture");

describe("example actions", () => {
  it("builds an agent prompt with the verified pull command and integration instructions", () => {
    const prompt = buildExamplePrompt(gradient);

    expect(prompt).toContain("npx vgpu examples pull gradient --out ./gradient");
    expect(prompt).toContain("install any required dependencies");
    expect(prompt).toContain("Preserve its WebGPU behavior and resource cleanup");
  });

  it("exposes every source file as a v0-fetchable registry item", () => {
    const item = buildExampleV0RegistryItem(gradient);

    expect(item.$schema).toBe("https://ui.shadcn.com/schema/registry-item.json");
    expect(item.type).toBe("registry:block");
    expect(item.dependencies).toEqual(expect.arrayContaining(["react", "vgpu"]));
    expect(item.files).toHaveLength(gradient.sources.length);
    expect(item.files[0]).toMatchObject({
      path: "examples/gradient/index.tsx",
      target: "~/examples/gradient/index.tsx",
      type: "registry:file",
      content: gradient.sources[0].code,
    });
  });

  it("opens v0 with the public registry endpoint", () => {
    const url = new URL(buildV0OpenUrl("gradient"));

    expect(url.origin + url.pathname).toBe("https://v0.app/chat/api/open");
    expect(url.searchParams.get("url")).toBe("https://vgpu.sh/examples/gradient/v0.json");
  });
});
