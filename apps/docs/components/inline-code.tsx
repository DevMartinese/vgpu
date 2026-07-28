import { Fragment } from 'react';

/** Strips the `backtick` markers, giving the plain text to put on the clipboard. */
export function stripBackticks(text: string): string {
  return text.replace(/`/g, '');
}

/**
 * Renders a string where `backtick`-wrapped spans are set in mono.
 *
 * The homepage is set in Geist Serif, but commands have to stay monospaced, and
 * they are embedded mid-sentence ("... run `npx vgpu docs`"), so this is a span
 * swap rather than a block. Mono runs slightly larger than serif at the same
 * px size, so code is nudged to 0.95em to keep the baseline row even.
 */
export function InlineCode({ text }: { text: string }) {
  // Odd indices are the fenced spans: "a `b` c" -> ["a ", "b", " c"].
  return (
    <>
      {text.split('`').map((part, index) =>
        index % 2 === 1 ? (
          // nowrap: a command broken across two lines ("run npx" / "vgpu docs")
          // reads as prose, not as something you paste. Wrap before it instead.
          <code key={index} className="whitespace-nowrap font-mono text-[0.95em]">
            {part}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
