import type { GeistdocsAgentReadinessConfig } from "@vercel/geistdocs/config";

export const Logo = () => (
  <span className="font-semibold text-gray-1000 text-lg leading-none tracking-[-3%]">
    Geistdocs
  </span>
);

export const github = {
  branch: "main",
  editPath: "content/docs/{path}",
  owner: "vercel",
  repo: "geistdocs",
};

export const nav = [
  {
    label: "Docs",
    href: "/docs",
  },
  {
    label: "Source",
    href: `https://github.com/${github.owner}/${github.repo}/`,
  },
];

export const suggestions = [
  "What is Geistdocs?",
  "What can I make with Geistdocs?",
  "What syntax does Geistdocs support?",
  "How do I deploy my Geistdocs site?",
];

export const title = "Geistdocs Documentation";

export const prompt =
  "You are a helpful assistant specializing in answering questions about Geistdocs, a modern documentation template built with Next.js and Fumadocs.";

export const agent = {
  product: {
    name: "Geistdocs",
    description:
      "Geistdocs is a package-backed documentation system for creating Next.js and Fumadocs sites with shared Vercel documentation patterns.",
    category: "Documentation",
    audience: ["Documentation authors", "Developer experience teams"],
    useCases: [
      "Create package-backed documentation sites",
      "Expose docs as AI-readable Markdown",
      "Share Vercel docs UI and runtime behavior across projects",
    ],
  },
  links: [
    {
      label: "Geistdocs source",
      href: `https://github.com/${github.owner}/${github.repo}`,
      description: "Source repository for the Geistdocs package and template",
    },
  ],
} satisfies GeistdocsAgentReadinessConfig;

export const translations = {
  en: {
    displayName: "English",
  },
  cn: {
    displayName: "Chinese",
    search: "搜尋文檔",
  },
};

export const basePath: string | undefined = undefined;

/**
 * Unique identifier for this site, used in markdown request tracking analytics.
 * Each site using geistdocs should set this to a unique value (e.g. "ai-sdk-docs", "next-docs").
 */
export const siteId: string | undefined = undefined;
