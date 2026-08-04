"use client";

import { CodeBlock } from "@vercel/geistdocs/components/code-block";
import { useState } from "react";
import { cn } from "@/lib/utils";

// TGEIST-09: reads the example's source files exactly as returned by
// `getExample()`/`examples-registry.ts` (TGEIST-07, verbatim) and renders
// them with geistdocs' own `CodeBlock` chrome instead of the old app's
// custom `CodeViewer`/Shiki setup. A lightweight in-house file switcher is
// used instead of `CodeBlockTabs` (that helper's bundled types don't line up
// with a plain array of file tabs), keeping this to geistdocs primitives
// without fighting an unrelated typing mismatch.
export interface SourceFile {
  readonly name: string;
  readonly lang: string;
  readonly code: string;
}

interface ExampleSourceViewerProps {
  files: readonly SourceFile[];
}

export function ExampleSourceViewer({ files }: ExampleSourceViewerProps) {
  const [activeName, setActiveName] = useState(files[0]?.name);

  if (files.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-4 text-copy-14 text-gray-900">
        No source files available.
      </p>
    );
  }

  const active = files.find((file) => file.name === activeName) ?? files[0];

  return (
    <div className="flex flex-col gap-3">
      {files.length > 1 ? (
        <div className="flex flex-wrap gap-1 overflow-x-auto rounded-sm border bg-background-200 p-1">
          {files.map((file) => (
            <button
              className={cn(
                "rounded-sm px-3 py-1.5 font-mono text-sm transition-colors",
                file.name === active.name
                  ? "bg-background-100 text-gray-1000"
                  : "text-gray-800 hover:text-gray-1000",
              )}
              key={file.name}
              onClick={() => setActiveName(file.name)}
              type="button"
            >
              {file.name}
            </button>
          ))}
        </div>
      ) : null}
      <CodeBlock title={active.name}>
        <code>{active.code}</code>
      </CodeBlock>
    </div>
  );
}
