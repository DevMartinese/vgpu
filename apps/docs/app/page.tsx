import Link from 'next/link';
import { Card } from '@/components/card';
import { ExampleCard } from '@/components/example-card';
import { HomeHeader } from '@/components/home-header';
import { HeroTabs } from '@/components/hero-tabs';
import { HeroBlackHole } from '@/components/hero/hero-black-hole';
import { InlineCode } from '@/components/inline-code';
import { exampleMetadataBySlug } from '@/lib/examples-metadata';
import { geistSerif } from './fonts';

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
    // Geist Serif for the whole homepage; code fragments opt out with font-mono.
    <div className={`${geistSerif.variable} font-serif`}>
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
                'radial-gradient(ellipse 50% 50% at 50% 50%, #000 31%, rgba(0,0,0,0) 100%)',
            }}
          />

          {/* Second scrim, for the setup snippet now that it sits at the foot of
              the hero, off the centre ellipse and over open disk and starfield.

              Multi-stop rather than a plain two-stop fade: alpha interpolates
              linearly while perceived luminance does not, so `black -> transparent`
              leaves a visible ledge around its midpoint. These stops approximate
              an ease-out curve, which reads as haze instead of a band. It bottoms
              out at 0.82 rather than 1 so the disk still shows through, and the
              hero's foot meets the black page below without a seam. */}
          <div
            data-hero-overlay
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[45%]"
            style={{
              background:
                'linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.72) 18%, rgba(0,0,0,0.5) 38%, rgba(0,0,0,0.28) 58%, rgba(0,0,0,0.12) 76%, rgba(0,0,0,0) 100%)',
            }}
          />

          {/* Tagline, dead centre — it sits inside the shadow. */}
          <div
            data-hero-overlay
            className="pointer-events-none absolute inset-x-0 top-1/2 z-10 -translate-y-1/2 px-6"
          >
            <h1
              className="mx-auto max-w-[798px] text-center font-normal leading-[1.2] text-white"
              style={{ fontSize: 'clamp(1.6rem, 2.85vw, 2.6875rem)' }}
            >
              The WebGPU library,
              {/* Forces the two-line break of the design on wide viewports; on
                  narrow ones it collapses and the line wraps on its own. */}
              <br className="hidden sm:block" /> designed for agents.
            </h1>
          </div>

          {/* Setup snippet, anchored to the foot of the hero as in the design.
              Pinned to the bottom rather than a top percentage so it keeps a
              constant breathing space on short viewports instead of drifting up
              into the tagline (at 73% of an 844px phone it nearly collided). */}
          <div
            data-hero-overlay
            className="absolute bottom-10 left-1/2 z-10 w-[450px] max-w-[calc(100%-3rem)] -translate-x-1/2 lg:bottom-14"
          >
            <HeroTabs />
          </div>
        </section>

        <section className="mx-auto mb-24 mt-24 max-w-6xl px-6 lg:px-12">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h2 className="text-2xl text-gray-12">Examples</h2>
            <Link href="/examples" className="text-sm text-gray-9 transition-colors hover:text-gray-12">View all →</Link>
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {featuredExamples.map((example) => (
              <ExampleCard key={example.slug} example={example} />
            ))}
          </div>
        </section>

        <section className="mx-auto mb-24 max-w-4xl px-6 lg:px-12">
          <h2 className="mb-10 text-center text-2xl text-gray-12 md:text-3xl">Why vgpu</h2>
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

        <section className="mx-auto max-w-4xl px-6 lg:px-12">
          <h2 className="mb-12 text-center text-2xl text-gray-12 md:text-3xl">Explore the Docs</h2>
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
