import type { ExampleRecord } from "./examples-registry";
import { siteUrl } from "./site";

function inlineCode(value: string): string {
  const fence = value.includes("`") ? "``" : "`";
  return `${fence}${value}${fence}`;
}

export function buildExampleReadme(example: ExampleRecord): string {
  const { description, slug, title } = example.meta;
  const files = example.sources
    .map(({ name }) => `- ${inlineCode(name)}`)
    .join("\n");

  return `# ${title}

${description}

## Download

Download the complete verified example source:

\`\`\`bash
npx vgpu examples pull ${slug} --out ./${slug}
\`\`\`

## Explore

- [Interactive example](${siteUrl(`/examples/${slug}`)})
- [Fullscreen preview](${siteUrl(`/preview/${slug}`)})

## Included files

${files}
`;
}
