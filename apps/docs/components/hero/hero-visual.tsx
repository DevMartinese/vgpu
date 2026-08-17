"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";

const HeroBlackHole = dynamic(
  () => import("./hero-black-hole").then((module) => module.HeroBlackHole),
  { ssr: false },
);
const HeroFractal = dynamic(
  () => import("./hero-fractal").then((module) => module.HeroFractal),
  { ssr: false },
);

const DESKTOP_HERO_QUERY = "(min-width: 768px)";

/** Chooses one GPU hero visual; hidden variants are unmounted and disposed. */
export function HeroVisual() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP_HERO_QUERY);
    const update = () => setIsDesktop(query.matches);
    update();
    setMounted(true);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  // The server cannot know next-themes' resolved value. Keep the server and
  // first client render identical, then mount exactly one GPU renderer.
  if (!mounted) return null;

  if (resolvedTheme === "light") {
    return isDesktop ? <HeroFractal /> : null;
  }

  return <HeroBlackHole />;
}
