import type { ExampleRecord } from "./examples-registry";
import { siteUrl } from "./site";

const IMPORT_SPECIFIER = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/gu;

function packageName(specifier: string): string | undefined {
  if (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("node:")
  ) {
    return undefined;
  }

  if (specifier.startsWith("@")) {
    const [scope, name] = specifier.split("/");
    return scope && name ? `${scope}/${name}` : undefined;
  }

  return specifier.split("/")[0] || undefined;
}

function externalDependencies(example: ExampleRecord): string[] {
  const dependencies = new Set<string>();

  for (const { code } of example.sources) {
    for (const match of code.matchAll(IMPORT_SPECIFIER)) {
      const dependency = packageName(match[1]);
      if (dependency) dependencies.add(dependency);
    }
  }

  return [...dependencies].sort();
}

export function buildExamplePrompt(example: ExampleRecord): string {
  const { slug, title } = example.meta;

  return `Use the “${title}” vgpu example as a starting point for my project.

Pull the complete, verified source into the current workspace with:

\`\`\`bash
npx vgpu examples pull ${slug} --out ./${slug}
\`\`\`

Then inspect the downloaded files, install any required dependencies, and integrate the example into the existing app. Preserve its WebGPU behavior and resource cleanup, adapt only what the project needs, and explain the changes you make.`;
}

export function buildExampleV0RegistryItem(example: ExampleRecord) {
  const { description, slug, title } = example.meta;
  const dependencies = externalDependencies(example);

  return {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    name: `vgpu-${slug}`,
    type: "registry:block",
    title,
    description,
    ...(dependencies.length > 0 ? { dependencies } : {}),
    files: example.sources.map(({ code, name }) => ({
      path: `examples/${slug}/${name}`,
      content: code,
      type: "registry:file",
      target: `~/examples/${slug}/${name}`,
    })),
    meta: {
      command: `npx vgpu examples pull ${slug} --out ./${slug}`,
      source: siteUrl(`/examples/${slug}/source.md`),
    },
  } as const;
}

export function buildV0OpenUrl(slug: string): string {
  const query = new URLSearchParams({
    url: siteUrl(`/examples/${slug}/v0.json`),
  });
  return `https://v0.app/chat/api/open?${query.toString()}`;
}
