import { HeroTabProvider } from "@/components/hero/hero-tab-state";
import { Button } from "@/components/ui/button";
import { VgpuWordmarkGlyphs } from "@/components/vgpu-wordmark";
import DynamicLink from "fumadocs-core/dynamic-link";
import { HeroTabs } from "./hero-tabs";
import { PrismBackground } from "./prism-background/prism-background";
import "../hero-glass-button.css";
import "../hero-theme.css";

/**
 * Landing hero.
 *
 * The prism scene is a client-owned WebGPU background. The rest of the hero
 * stays server-rendered and layered above it.
 */
export function Hero() {
  return (
    <HeroTabProvider>
      <section
        data-hero-theme
        className="relative h-[calc(100svh-4rem)] max-h-[50em] overflow-hidden"
      >
        <div
          data-hero-container
          className="relative mx-auto h-full w-full max-w-[1448px] overflow-hidden"
        >
          <PrismBackground />

          {/* Foot fade. This was a tall, near-opaque band back when the setup
            snippet was pinned to the bottom and needed contrast; the snippet
            now sits centred with the tagline, so that job is gone and the band
            was only costing us the lower crescent. What remains is the other
            job it was doing: the hero ends mid-starfield, and cutting straight
            to the black page below leaves a visible seam. Short and gentle is
            enough to hide it.

            Multi-stop rather than a plain two-stop fade: alpha interpolates
            linearly while perceived luminance does not, so `black -> transparent`
            leaves a visible ledge around its midpoint. These stops approximate
            an ease-out curve, which reads as haze instead of a band. */}
          <div
            data-hero-overlay
            data-hero-foot-fade
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-[16%]"
          />

          {/* The HTML takes a fixed content column on desktop; the invisible
            triangle container receives every remaining pixel inside this same
            bounded hero container. Both it and the canvas are therefore
            measured in one coordinate system, including on very wide screens.

            The overlay is pointer-events-none so it never eats clicks over the
            rest of the hero, but the content opts back IN. */}
          <div
            data-hero-overlay
            className="pointer-events-none absolute inset-0 z-10 grid grid-cols-1 px-6 py-[clamp(3rem,8svh,6rem)] min-[768px]:justify-items-start min-[1100px]:grid-cols-[minmax(0,21em)_minmax(0,1fr)] min-[1100px]:gap-[clamp(2rem,5vw,5rem)]"
          >
            <div className="pointer-events-auto relative z-10 flex flex-col items-center self-center justify-self-center min-[768px]:items-start min-[768px]:justify-self-start min-[1100px]:col-start-1 min-[1100px]:row-start-1">
              <h1
                aria-label="vgpu"
                data-hero-title
                className="mb-[1em] aspect-[179.2/75] w-[200px]"
              >
                <svg
                  aria-hidden="true"
                  className="block size-full"
                  fill="currentColor"
                  viewBox="0 0 179.2 75"
                >
                  <VgpuWordmarkGlyphs />
                </svg>
              </h1>
              <p
                className="max-w-[10em] text-4xl text-balance text-center font-light leading-tight min-[768px]:text-left"
              >
                The WebGPU library, designed for agents.
              </p>
              <div className="mt-20 w-full max-w-[21em]">
                <HeroTabs />
              </div>
              <div
                hidden
                className="mt-8 flex flex-wrap items-center justify-center gap-3 min-[768px]:justify-start"
              >
                <Button
                  asChild
                  size="lg"
                  className="bg-white text-black hover:bg-white/90"
                >
                  <DynamicLink href="/[lang]/docs/get-started">
                    Get started
                  </DynamicLink>
                </Button>
                <Button
                  asChild
                  size="lg"
                  variant="outline"
                  className="hero-glass-button text-white shadow-none hover:text-white"
                >
                  <DynamicLink href="/[lang]/examples">
                    Explore examples
                  </DynamicLink>
                </Button>
              </div>
            </div>

            <div
              className="pointer-events-none p-20 absolute inset-0 min-[1100px]:static min-[1100px]:col-start-2 min-[1100px]:row-start-1 min-[1100px]:size-full min-[1100px]:min-h-0"
            >
              <div
                data-triangle-container
                aria-hidden="true"
                className="size-full"
              />
            </div>
          </div>
        </div>
      </section>
    </HeroTabProvider>
  );
}
