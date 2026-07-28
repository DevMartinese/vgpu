import type { Metadata } from 'next';
import { ExamplesSidebar } from '@/components/examples-sidebar';

export const metadata: Metadata = {
  title: {
    default: 'examples',
    template: 'vgpu | %s',
  },
  description: 'Interactive WebGPU examples built with vgpu.',
};

export default function ExamplesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ExamplesSidebar />
      <main className="min-h-screen lg:pl-72">{children}</main>
    </>
  );
}
