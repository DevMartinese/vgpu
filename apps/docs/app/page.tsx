import Link from 'next/link';
import localFont from 'next/font/local';
import { Card } from '@/components/card';
import { ExampleCard } from '@/components/example-card';
import { HomeHeader } from '@/components/home-header';
import { HeroTabs } from '@/components/hero-tabs';
import { HeroBlackHole } from '@/components/hero/hero-black-hole';
import { exampleMetadataBySlug } from '@/lib/examples-metadata';

const geistSerif = localFont({
  src: './fonts/GeistSerifV0.2-Regular.otf',
  display: 'swap',
});

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

export default function HomePage() {
  return (
    <>
      <HomeHeader />
      <main className="pb-16 lg:pb-20">
      <section className="relative flex min-h-svh items-center justify-center overflow-hidden text-center">
        <HeroBlackHole />
        {/* data-hero-overlay: hidden by the panel's "hide UI" toggle (globals.css). */}
        <div data-hero-overlay className="pointer-events-none absolute inset-0 z-[1] bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.36),rgba(0,0,0,0.1)_55%,rgba(0,0,0,0.5))]" />
        <div data-hero-overlay className="relative z-10 mx-auto w-full max-w-4xl px-6">
          <h1 style={{ WebkitTextStroke: '1px white' }} className={`${geistSerif.className} mb-6 text-5xl font-normal tracking-tight text-black md:text-6xl lg:text-7xl`}>vgpu</h1>
          <p className="mx-auto mb-8 max-w-2xl text-balance text-lg leading-relaxed text-gray-10 [text-shadow:0_1px_12px_rgb(0_0_0_/_0.9)] md:text-xl">The low-level WebGPU library, designed for agents.</p>
          <div className="mb-8 flex justify-center gap-5">
            <Link href="/docs/get-started" className="text-sm text-gray-9 transition-colors hover:text-gray-12 [text-shadow:0_1px_12px_rgb(0_0_0_/_0.9)]">Get started →</Link>
            <Link href="/examples" className="text-sm text-gray-9 transition-colors hover:text-gray-12 [text-shadow:0_1px_12px_rgb(0_0_0_/_0.9)]">Examples →</Link>
          </div>
          <div className="mx-auto max-w-xl"><HeroTabs /></div>
        </div>
      </section>

      <section className="mx-auto mb-24 max-w-6xl px-6 lg:px-12">
        <div className="flex items-center justify-between gap-4 mb-6">
          <h2 className="text-2xl font-semibold text-gray-12">Examples</h2>
          <Link href="/examples" className="text-sm text-gray-9 transition-colors hover:text-gray-12">View all →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {featuredExamples.map((example) => (
            <ExampleCard key={example.slug} example={example} />
          ))}
        </div>
      </section>

      <section className="mx-auto mb-24 max-w-4xl px-6 lg:px-12">
        <h2 className="text-2xl md:text-3xl font-semibold text-gray-12 text-center mb-10">Why vgpu</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {pillars.map((pillar) => (
            <Card key={pillar.title} className="rounded-lg bg-gray-1 border border-gray-4 overflow-hidden">
              <Card.Header className="border-gray-4 bg-gray-2">
                <h3 className="text-sm font-semibold text-gray-12">{pillar.title}</h3>
              </Card.Header>
              <Card.Body className="p-5">
                <p className="text-sm text-gray-9 leading-relaxed">{pillar.description}</p>
                <div className="mt-5 break-words rounded-md border border-gray-4 bg-black px-3 py-2 font-mono text-sm text-gray-10 whitespace-normal">
                  {pillar.code}
                </div>
              </Card.Body>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-6 lg:px-12">
        <h2 className="text-2xl md:text-3xl font-semibold text-gray-12 text-center mb-12">Explore the Docs</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            ['/docs/get-started', 'Getting Started', 'Install `vgpu` and render with `init()`.'],
            ['/docs/concepts', 'Core Concepts', 'Learn Gpu, set(), targets, frames, bundles, and adapters.'],
            ['/docs/reference', 'API Reference', 'Package map and generated topic pages.'],
            ['/examples', 'Examples', 'Live WebGPU demos with read-only source views.'],
          ].map(([href, title, description]) => (
            <Link key={href} href={href} className="group p-6 rounded-lg bg-gray-1 border border-gray-4 hover:border-gray-5 transition-all">
              <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-12 group-hover:text-blue-9 transition-colors">{title} →</h3></div>
              <p className="text-sm text-gray-9">{description}</p>
            </Link>
          ))}
        </div>
      </section>
      </main>
    </>
  );
}
