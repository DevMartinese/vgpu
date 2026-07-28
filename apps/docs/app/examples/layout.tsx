import { ExamplesSidebar } from '@/components/examples-sidebar';

export default function ExamplesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ExamplesSidebar />
      <main className="min-h-screen lg:pl-72">{children}</main>
    </>
  );
}
