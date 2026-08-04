import { Badge } from "@vercel/geistdocs/components/badge";
import type { ReactNode } from "react";

interface HeroProps {
  badge: string;
  children: ReactNode;
  description: string;
  title: string;
}

export const Hero = ({ badge, title, description, children }: HeroProps) => (
  <section className="mt-(--fd-nav-height) space-y-6 px-4 @min-[640px]:pt-24 pt-16 pb-16 text-center">
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <Badge className="rounded-full" variant="secondary">
        <div className="size-2 rounded-full bg-gray-800" />
        <p>{badge}</p>
      </Badge>
      <h1 className="text-balance text-center font-[450]! @min-[1280px]:text-6xl! @min-[640px]:text-5xl! text-[40px]! leading-[1.1] tracking-tighter">
        {title}
      </h1>
      <p className="mx-auto max-w-3xl text-balance @min-[640px]:text-xl text-gray-800 leading-relaxed">
        {description}
      </p>
    </div>
    {children}
  </section>
);
