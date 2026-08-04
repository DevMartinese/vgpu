import type { Metadata } from "next";

// TGEIST-09: metadata-only wrapper -- chrome (Navbar/Footer) already comes
// from `app/[lang]/layout.tsx`; `/examples` does not get a bespoke sidebar
// like the old app's `ExamplesSidebar` (Decision 1': chrome rehecho with
// geistdocs primitives, same as the `/templates`-style top-level sections in
// the reference geistdocs deployment).
export const metadata: Metadata = {
  title: {
    default: "Examples",
    template: "%s | Examples",
  },
  description: "Interactive WebGPU examples built with vgpu.",
};

export default function ExamplesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
