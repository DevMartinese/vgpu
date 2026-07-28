import type { Metadata } from 'next';
import { Navigation } from '@/components/navigation';

export const metadata: Metadata = {
  title: {
    default: 'docs',
    template: 'vgpu | %s',
  },
  description: 'Documentation for vgpu, the WebGPU library designed for agents.',
};

export default function NavLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navigation />
      <main className="lg:pl-64">
        <div className="min-h-screen">
          {children}
        </div>
      </main>
    </>
  );
}
