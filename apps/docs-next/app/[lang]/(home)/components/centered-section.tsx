import type { ReactNode } from "react";

interface CenteredSectionProps {
  children: ReactNode;
  description: string;
  title: string;
}

export const CenteredSection = ({
  title,
  description,
  children,
}: CenteredSectionProps) => (
  <div className="grid items-center gap-10 overflow-hidden @min-[640px]:px-12 px-4 @min-[640px]:py-12 py-8">
    <div className="mx-auto grid max-w-lg gap-4 text-center">
      <h2 className="font-[450]! @min-[1024px]:text-[40px] @min-[640px]:text-2xl @min-[768px]:text-3xl text-gray-1000 text-xl tracking-tighter">
        {title}
      </h2>
      <p className="text-balance text-gray-800 text-lg">{description}</p>
    </div>

    {children}
  </div>
);
