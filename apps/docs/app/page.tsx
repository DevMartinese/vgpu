import Link from 'next/link';
import { Card } from '@/components/card';
import { ExampleCard } from '@/components/example-card';
import { HomeHeader } from '@/components/home-header';
import { HeroTabs } from '@/components/hero-tabs';
import { HeroBlackHole } from '@/components/hero/hero-black-hole';
import { InlineCode } from '@/components/inline-code';
import { exampleMetadataBySlug } from '@/lib/examples-metadata';

const featuredExamples = [
  exampleMetadataBySlug['black-hole'],
  exampleMetadataBySlug['raymarched-fractal'],
  exampleMetadataBySlug['fft-ocean'],
  exampleMetadataBySlug['triangle-led-front'],
];

const pillars = [
  {
    title: 'WGSL modules',
    description: 'Import and export WGSL like TypeScript. Compose shaders from modules, not string templates.',
    code: 'import { noise } from "./noise.wgsl"',
  },
  {
    title: 'Ready for agents',
    description: 'Docs, CLI and skill built for coding agents. Your agent gets the full API in one command.',
    code: 'npx vgpu docs',
  },
  {
    title: 'Runs on web and Node.js',
    description: 'One API everywhere. Render to canvas in the browser, test and screenshot headlessly in Node.',
    code: 'import { init } from "vgpu/node"',
  },
];

const docLinks = [
  ['/docs/get-started', 'Getting Started', 'Install `vgpu` and render with `init()`.'],
  ['/docs/concepts', 'Core Concepts', 'Learn Gpu, set(), targets, frames, bundles, and adapters.'],
  ['/docs/reference', 'API Reference', 'Package map and generated topic pages.'],
  ['/examples', 'Examples', 'Live WebGPU demos with read-only source views.'],
];

export default function HomePage() {
  return (
    // Sans, like the rest of the site. Geist Serif is opted into per element
    // (the wordmark in HomeHeader, the tagline below, HeroTabs) — it is a
    // display face and reads badly on body copy and section headings.
    <div>
      <HomeHeader />
      <main className="pb-16 lg:pb-20">
        {/* Hero: the shader is the full section and the copy is positioned on
            top of it — the tagline centred so it tracks the shadow at any
            height, the setup snippet pinned to the bottom edge. Everything
            overlaid is `data-hero-overlay` so the tuning panel's "hide UI"
            toggle can strip it back to the bare shader. */}
        <section className="relative min-h-svh overflow-hidden">
          <HeroBlackHole />

          {/* Legibility scrim. Matches the Figma ellipse: a band centred on the
              hero, opaque black through the core and fully transparent at the
              edges, so the disk still burns through at the left and right. */}
          <div
            data-hero-overlay
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-1/2 z-[1] h-[62%] -translate-y-1/2"
            style={{
              background:
                'radial-gradient(ellipse 50% 50% at 50% 50%, #000 31%, rgba(0,0,0,0) 60%)',
            }}
          />

          {/* Foot fade. This was a tall, near-opaque band back when the setup
              snippet was pinned to the bottom and needed contrast; the snippet
              now sits centred with the tagline, so that job is gone and the band
              was only costing us the lower crescent. What remains is the other
              job it was doing: the hero ends mid-starfield, and cutting straight
              to the black page below leaves a visible seam. Short and gentle is
              enough to hide it.

              Multi-stop rather than a plain two-stop fade: alpha interpolates
              linearly while perceived luminance does not, so `black -> transparent`
              leaves a visible ledge around its midpoint. These stops approximate
              an ease-out curve, which reads as haze instead of a band. */}
          <div
            data-hero-overlay
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[16%]"
            style={{
              background:
                'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.52) 24%, rgba(0,0,0,0.3) 48%, rgba(0,0,0,0.13) 72%, rgba(0,0,0,0) 100%)',
            }}
          />

          {/* Tagline + setup snippet, one block centred on the hero — it sits
              inside the shadow.

              The band is pointer-events-none so it never eats clicks over the
              rest of the hero, but the children opt back IN: without that the
              tagline cannot be selected and the tabs cannot be clicked, because
              pointer-events is inherited. */}
          <div
            data-hero-overlay
            className="pointer-events-none absolute inset-x-0 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-10 px-6 lg:gap-12"
          >
            <h1
              className="pointer-events-auto max-w-[798px] text-center font-light leading-[1.25] text-white"
              /* Sized off the viewport HEIGHT, not the width: the tagline has
                 to stay inside the black hole's shadow, and the shadow is a
                 circle scaled by the shorter axis. 2.4svh = 21.6px at 900px
                 tall. The clamp floor keeps it readable on short landscape
                 phones and the ceiling stops it ballooning on tall monitors. */
              style={{ fontSize: 'clamp(1rem, 4svh, 10.75rem)' }}
            >
              The WebGPU library,
              {/* Forces the two-line break of the design on wide viewports; on
                  narrow ones it collapses and the line wraps on its own. */}
              <br className="hidden sm:block" /> designed for agents.
            </h1>

            {/* Setup snippet, reading as one unit with the tagline above it.
                Part of the centred flex column rather than pinned to the foot
                of the hero, so the pair stays together and stays inside the
                shadow at any viewport height. */}
            <div className="pointer-events-auto w-[450px] max-w-full">
              <HeroTabs />
            </div>
          </div>
        </section>

        <section className="mx-auto mb-24 mt-24 max-w-6xl px-6 lg:px-12">
          {/* The heading carries the same type classes as the other two
              sections; the bottom margin lives on this row instead of on the
              h2 so the "View all" link is spaced with it. */}
          <div className="mb-10 flex items-center justify-between gap-4">
            <h2 className="text-2xl text-gray-12 md:text-3xl">Examples</h2>
            <Link href="/examples" className="text-sm text-gray-9 transition-colors hover:text-gray-12">View all →</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {featuredExamples.map((example) => (
              <ExampleCard key={example.slug} example={example} />
            ))}
          </div>
        </section>

        <section className="mx-auto mb-24 max-w-6xl px-6 lg:px-12">
          <h2 className="mb-10 text-2xl text-gray-12 md:text-3xl">Why vgpu</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {pillars.map((pillar) => (
              <Card key={pillar.title} className="overflow-hidden rounded-lg border border-gray-4 bg-gray-1">
                <Card.Header className="border-gray-4 bg-gray-2">
                  <h3 className="text-sm text-gray-12">{pillar.title}</h3>
                </Card.Header>
                <Card.Body className="p-5">
                  <p className="text-sm leading-relaxed text-gray-9">{pillar.description}</p>
                  <div className="mt-5 whitespace-normal break-words rounded-md border border-gray-4 bg-black px-3 py-2 font-mono text-sm text-gray-10">
                    {pillar.code}
                  </div>
                </Card.Body>
              </Card>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 lg:px-12">
          <h2 className="mb-10 text-2xl text-gray-12 md:text-3xl">Explore the Docs</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {docLinks.map(([href, title, description]) => (
              <Link key={href} href={href} className="group rounded-lg border border-gray-4 bg-gray-1 p-6 transition-all hover:border-gray-5">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-gray-12 transition-colors group-hover:text-blue-9">{title} →</h3>
                </div>
                <p className="text-sm text-gray-9"><InlineCode text={description} /></p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
