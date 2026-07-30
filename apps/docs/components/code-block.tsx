import { Terminal } from "lucide-react";
import { highlightCode, countLinesInHtml } from "@/lib/shiki";
import { CopyButton } from "./copy-button";
import { Card } from "./card";

interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
}

// Display names only.
//
// These labels used to carry a per-language brand colour — TypeScript blue,
// Bash green, JSON near-black — so every header in a page came out a different
// accent and the docs read as a patchwork. They are one grey now, and the colour
// field is deleted rather than left dead for someone to wire back up.
const languageConfig: Record<string, { name: string }> = {
  typescript: { name: "TypeScript" },
  ts: { name: "TypeScript" },
  javascript: { name: "JavaScript" },
  js: { name: "JavaScript" },
  wgsl: { name: "WGSL" },
  bash: { name: "Bash" },
  shell: { name: "Shell" },
  json: { name: "JSON" },
  html: { name: "HTML" },
  css: { name: "CSS" },
};

export async function CodeBlock({
  code,
  language = "typescript",
  filename,
  showLineNumbers = false,
}: CodeBlockProps) {
  const langConfig = languageConfig[language] || { name: language.toUpperCase() };
  
  // Highlight code on the server at render time
  const highlightedHtml = await highlightCode(code, language);
  // Count actual line elements from Shiki's HTML output, not from raw code
  const lineCount = countLinesInHtml(highlightedHtml);

  return (
    <Card className="group relative rounded-lg border border-[#333] bg-[#0a0a0a] overflow-hidden my-4">
      {/* Header */}
      <Card.Header className="border-[#333] bg-[#111]">
        <div className="flex items-center gap-2">
          {filename ? (
            <span className="text-sm text-gray-11">{filename}</span>
          ) : (
            <div className="flex items-center gap-2">
              <Terminal className="w-4 h-4 text-gray-9" />
              <span className="text-sm text-gray-11">{langConfig.name}</span>
            </div>
          )}
        </div>
        <CopyButton code={code} />
      </Card.Header>

      {/* Code content */}
      <Card.Body className="relative overflow-x-auto">
        {showLineNumbers ? (
          <div className="flex">
            {/* Line numbers */}
            <div className="flex-none py-4 pl-4 pr-3 text-right select-none border-r border-[#333] bg-[#0a0a0a]">
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i} className="text-sm leading-6 text-[#444] font-mono">
                  {i + 1}
                </div>
              ))}
            </div>
            {/* Code */}
            <div className="flex-1 py-4 px-4 overflow-x-auto">
              <div 
                className="text-sm leading-6 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!bg-transparent [&_code]:!text-sm [&_code]:!leading-6 [&_code_span.line]:!leading-6"
                dangerouslySetInnerHTML={{ __html: highlightedHtml }}
              />
            </div>
          </div>
        ) : (
          <div className="py-4 px-4 overflow-x-auto">
            <div 
              className="text-sm leading-6 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!bg-transparent"
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </div>
        )}
      </Card.Body>
    </Card>
  );
}
