import { vercelAdapter } from "@flags-sdk/vercel";
import { flag } from "flags/next";

const heroCanvasDecision = process.env.FLAGS
  ? { adapter: vercelAdapter() }
  : { decide: () => false };

export const heroCanvas = flag<boolean>({
  key: "hero-canvas",
  ...heroCanvasDecision,
  defaultValue: false,
  description: "Release the prism hero canvas",
  options: [
    { value: false, label: "Hidden" },
    { value: true, label: "Released" },
  ],
});

export const homepageFlags = [heroCanvas] as const;

export const flagDefinitions = { heroCanvas };
