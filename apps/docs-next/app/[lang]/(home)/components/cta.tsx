import DynamicLink from "fumadocs-core/dynamic-link";
import { Button } from "@/components/ui/button";

interface CTAProps {
  cta: string;
  href: string;
  title: string;
}

export const CTA = ({ title, href, cta }: CTAProps) => (
  <section className="flex @min-[768px]:flex-row flex-col items-center @min-[768px]:justify-between gap-4 @min-[640px]:px-12 px-8 py-10">
    <h2 className="@min-[768px]:text-left text-center font-[450]! @min-[640px]:text-heading-40 text-gray-1000 text-heading-32 tracking-tighter">
      {title}
    </h2>
    <Button asChild className="w-fit rounded-full" size="lg">
      <DynamicLink href={`/[lang]${href}`}>{cta}</DynamicLink>
    </Button>
  </section>
);
