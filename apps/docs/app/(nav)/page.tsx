import Link from 'next/link';
import { CodeBlock } from '@/components/code-block';
import { HeroTabs } from '@/components/hero-tabs';

const heroCode = `import { init } from "vgpu";

const gpu = await init();
const surface = gpu.surface(canvas, { dpr: [1, 2] });
const wave = gpu.effect(WAVE_WGSL, { set: { speed: 2 } });

gpu.frame.loop(() => {
  wave.set({ time: gpu.time });
  wave.draw();
});`;

const features = [
  ['Browser and Node', 'Render shaders on a website, write tests or render on the server. vgpu just works.'],
  ['WGSL modules', 'import/export wgsl code just like typescript modules.'],
  ['Perf by default', 'Bundles, pre-warmed pipelines, dynamic offsets, shared uniforms, and bake patterns.'],
];

export default function HomePage() {
  return (
    <div className="px-6 pb-16 lg:px-12 lg:pb-20">
      <section className="min-h-[90svh] max-w-4xl mx-auto flex flex-col justify-center text-center mb-16">
        <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold text-gray-12 mb-6 tracking-tight">vgpu</h1>
        <p className="text-balance text-lg md:text-xl text-gray-10 mb-10 max-w-2xl mx-auto leading-relaxed">The low-level WebGPU library, designed for agents.</p>
        <HeroTabs />
        <div className="mt-5 flex justify-center gap-5">
          <Link href="/get-started" className="text-sm text-gray-9 transition-colors hover:text-gray-12">Get started →</Link>
          <Link href="/examples" className="text-sm text-gray-9 transition-colors hover:text-gray-12">Examples →</Link>
        </div>
      </section>
      <div className="text-left max-w-2xl mx-auto mb-24"><CodeBlock code={heroCode} language="typescript" /></div>
      <section className="max-w-4xl mx-auto mb-24">
        <h2 className="text-2xl md:text-3xl font-semibold text-gray-12 text-center mb-4">Everything You Need</h2>
        <p className="text-gray-9 text-center mb-12 max-w-xl mx-auto">Start with the public `vgpu` API. Drop to native WebGPU only when you need explicit control.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map(([title, description]) => (
            <div key={title} className="p-5 rounded-lg bg-gray-1 border border-gray-4 hover:border-gray-5 transition-colors group">
              <h3 className="text-sm font-semibold text-gray-12 mb-2">{title}</h3>
              <p className="text-sm text-gray-9 leading-relaxed">{description}</p>
            </div>
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
