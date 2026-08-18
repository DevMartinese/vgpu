"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const HeroBlackHole = dynamic(
  () => import("./hero-black-hole").then((module) => module.HeroBlackHole),
  { ssr: false }
);
/** Mounts the dark-mode GPU visual only after the client theme is known. */
export function HeroVisual() {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // The server cannot know next-themes' resolved value. Keep the server and
  // first client render identical, then mount the black hole only in dark mode.
  if (!mounted || resolvedTheme !== "dark") return null;

  return <HeroBlackHole />;
}
