import { HeroVisual } from "@/components/hero/hero-visual";
import { HeroTabProvider } from "@/components/hero/hero-tab-state";
import localFont from "next/font/local";
import { HeroTabs } from "./hero-tabs";
import "../hero-light-invert.css";

const geistSerif = localFont({
  src: "./geist-serif-v0.2-regular.otf",
  weight: "400",
  style: "normal",
});

/**
 * Landing hero.
 *
 * The dark-mode shader is the full section; the copy sits on top of it. Light
 * mode intentionally keeps the visual layer empty while a replacement is
 * designed. Structure, overlays and copy are ported unchanged from the old
 * homepage hero.
 */
export function Hero() {
  return (
    <HeroTabProvider>
      <section
        data-hero-invert
        className="relative min-h-svh overflow-hidden bg-black"
      >
        <HeroVisual />

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
          style={{
            background:
              "linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.52) 24%, rgba(0,0,0,0.3) 48%, rgba(0,0,0,0.13) 72%, rgba(0,0,0,0) 100%)",
          }}
        />

        {/* Tagline + setup snippet, one block aligned to the left of the hero.

          The band is pointer-events-none so it never eats clicks over the
          rest of the hero, but the children opt back IN: without that the
          tagline cannot be selected and the tabs cannot be clicked, because
          pointer-events is inherited. */}
        <div
          data-hero-overlay
          className="pointer-events-none absolute inset-x-0 top-1/2 z-10 mx-auto flex w-full max-w-[1448px] -translate-y-1/2 flex-col items-center gap-10 px-6 min-[768px]:items-start lg:gap-12"
        >
          <div className="pointer-events-auto flex flex-col items-center min-[768px]:items-start">
            <h1
              data-hero-title
              className={`${geistSerif.className} mb-[0.6em] text-center text-[clamp(4rem,8vw,8rem)] font-thin leading-[0.5] tracking-[-0.03em] text-black min-[768px]:text-left`}
            >
              <span className="tracking-[-0.05em]">v</span>gpu
            </h1>
            <p
              className="max-w-[10em] text-balance text-center font-light leading-tight text-white min-[768px]:text-left"
              style={{ fontSize: "clamp(1rem, 4svh, 10.75rem)" }}
            >
              The WebGPU library, designed for agents.
            </p>
          </div>

          {/* Setup snippet, reading as one unit with the tagline above it. */}
          <div className="pointer-events-auto w-[450px] max-w-full">
            <HeroTabs />
          </div>
        </div>
      </section>
    </HeroTabProvider>
  );
}
