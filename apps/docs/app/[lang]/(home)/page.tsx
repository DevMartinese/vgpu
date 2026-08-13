import type { Metadata } from "next";
import { AgentCommandSection } from "./components/agent-command-section";
import { DocsLinksSection } from "./components/docs-links-section";
import { ExamplesSection } from "./components/examples-section";
import { Hero } from "./components/hero";
import { OneShaderEverySurfaceSection } from "./components/one-shader-every-surface-section";
import { ShaderCodeScalesSection } from "./components/shader-code-scales-section";
import "./hero-solo.css";

// Landing metadata + body copy carried over unchanged from the old
// `apps/docs/app/page.tsx` (this ticket rebuilds the chrome, not the text —
// see TGEIST-10).
const title = "vgpu";
const description = "The WebGPU library, designed for agents.";

export const metadata: Metadata = {
  title,
  description,
};

const HomePage = () => (
  // Sans, like the rest of the site — matches the old landing's choice not to
  // opt any body copy into Geist Serif.
  <div>
    <Hero />
    <main className="mx-auto max-w-6xl px-6 pb-16 lg:px-12 lg:pb-20">
      <OneShaderEverySurfaceSection />
      <ShaderCodeScalesSection />
      <AgentCommandSection />
      <ExamplesSection />
      <DocsLinksSection />
    </main>
  </div>
);

export default HomePage;
