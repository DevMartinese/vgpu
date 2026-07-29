'use client';

import { Fragment, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { InlineCode, stripBackticks } from './inline-code';

/** `backtick` spans render mono; the rest stays in the page serif. */
const tabContent = {
  Prompt: 'Setup vgpu on my project, run `npx vgpu docs`',
  Skill: '`npx skills add vercel-labs/vgpu`',
} as const;

type Tab = keyof typeof tabContent;

const tabs = Object.keys(tabContent) as Tab[];

/**
 * Hero setup snippet: a text-only tab switcher over a hairline rule.
 *
 * Deliberately not a card — it sits directly on the shader, so the only chrome
 * is the divider. Copy is the whole line rather than a button: the icon is just
 * an affordance that fades in on hover, and confirmation is a swap to a check.
 */
export function HeroTabs() {
  const [activeTab, setActiveTab] = useState<Tab>('Prompt');
  const [copied, setCopied] = useState(false);
  const content = tabContent[activeTab];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stripBackticks(content));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard can be blocked (insecure origin, denied permission). The
      // snippet is on screen and selectable, so failing silently is fine.
    }
  };

  return (
    // No `gap` on the column: the rule carries its own asymmetric margins (see
    // below), and a gap would add to both sides equally.
    // font-serif on the wrapper covers the tabs and the snippet copy; the code
    // fragments inside opt back out to mono in InlineCode.
    <div className="flex w-full flex-col font-serif">
      <div
        role="tablist"
        aria-label="Setup option"
        className="flex items-center justify-center text-[15px] leading-none lg:text-[16px]"
      >
        {tabs.map((tab, index) => (
          <Fragment key={tab}>
            {index > 0 && (
              <span aria-hidden className="px-2 text-white/30">
                ·
              </span>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={
                activeTab === tab ? 'text-white' : 'text-white/50 hover:text-white/80'
              }
            >
              {tab}
            </button>
          </Fragment>
        ))}
      </div>

      {/*
        Hairline rule that dissolves at both ends. A hard-edged 1px line reads as
        a UI seam pinned over the shader; fading the ends lets it sit in the
        image instead. Gradient rather than a border since a border can't taper.

        No flat middle on purpose: sampling the rule in the Figma reference gives
        a symmetric triangle (alpha .57/.98/.56 at 25/50/75%), i.e. it peaks at
        #4D4D4D dead centre and ramps straight down to both ends. A solid centre
        band reads noticeably heavier than the reference.
      */}
      {/*
        Asymmetric margins, not a uniform column gap: the rule belongs to the
        snippet below it, so it sits closer to that than to the tabs above.

        The two numbers are not the two visual gaps. The tabs run `leading-none`
        (box hugs the glyphs) while the snippet runs `leading-relaxed` (~5px of
        half-leading above its ink), so an equal margin already reads as a
        bigger gap underneath. mt-5/mb-2 = 20/8px of box spacing lands at
        roughly 25/14px of measured ink-to-ink spacing.
      */}
      <div
        aria-hidden
        className="mb-2 mt-5 h-px w-full bg-[linear-gradient(to_right,transparent,#4D4D4D,transparent)]"
      />

      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : `Copy: ${stripBackticks(content)}`}
        className="group relative w-full px-7 text-center text-[15px] leading-relaxed text-white/90 transition-opacity hover:text-white lg:text-[16px]"
      >
        <InlineCode text={content} />
        <span
          aria-hidden
          className={`absolute right-0 top-1/2 -translate-y-1/2 transition-opacity ${
            copied ? 'opacity-90' : 'opacity-0 group-hover:opacity-50'
          }`}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </span>
      </button>
    </div>
  );
}
