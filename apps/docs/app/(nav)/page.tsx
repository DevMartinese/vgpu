import Link from 'next/link';
import { Card } from '@/components/card';
import { ExampleCard } from '@/components/example-card';
import { HeroTabs } from '@/components/hero-tabs';
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

export default function HomePage() {
  return (
    <div className="px-6 pb-16 lg:px-12 lg:pb-20">
      <section className="min-h-[90svh] max-w-6xl mx-auto flex flex-col justify-center mb-16">
        <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
          <div className="text-left">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-12 mb-6 tracking-tight">vgpu</h1>
            <p className="text-balance text-lg md:text-xl text-gray-10 mb-4 max-w-2xl leading-relaxed">The low-level WebGPU library, designed for agents.</p>
            <div className="mb-8 flex flex-wrap gap-2 text-sm text-gray-9">
              {['WGSL modules', 'Agent-ready', 'Web + Node.js'].map((pillar) => (
                <span key={pillar} className="rounded-full border border-gray-4 px-3 py-1">{pillar}</span>
              ))}
            </div>
            <div className="flex gap-5">
              <Link href="/get-started" className="text-sm text-gray-9 transition-colors hover:text-gray-12">Get started →</Link>
              <Link href="/examples" className="text-sm text-gray-9 transition-colors hover:text-gray-12">Examples →</Link>
            </div>
          </div>
          <HeroTabs />
        </div>
      </section>

      <section className="max-w-6xl mx-auto mb-24">
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

      <section className="max-w-4xl mx-auto mb-24">
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

      <section className="max-w-4xl mx-auto">
        <h2 className="text-2xl md:text-3xl font-semibold text-gray-12 text-center mb-12">Explore the Docs</h2>
        <div className="grid md:grid-cols-2 gap-4">
          {[
            ['/get-started', 'Getting Started', 'Install `vgpu` and render with `init()`.'],
            ['/concepts', 'Core Concepts', 'Learn Gpu, set(), targets, frames, bundles, and adapters.'],
            ['/reference', 'API Reference', 'Package map and generated topic pages.'],
            ['/examples', 'Examples', 'Live WebGPU demos with read-only source views.'],
          ].map(([href, title, description]) => (
            <Link key={href} href={href} className="group p-6 rounded-lg bg-gray-1 border border-gray-4 hover:border-gray-5 transition-all">
              <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-gray-12 group-hover:text-blue-9 transition-colors">{title} →</h3></div>
              <p className="text-sm text-gray-9">{description}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
