import type { ReactNode } from "react";

interface OneTwoSectionProps {
  children?: ReactNode;
  description: string;
  title: string;
}

export const OneTwoSection = ({
  title,
  description,
  children,
}: OneTwoSectionProps) => (
  <div className="grid @min-[640px]:grid-cols-3 @min-[640px]:gap-0 gap-12 @min-[640px]:p-0 p-8">
    <div className="flex flex-col gap-2 text-balance @min-[640px]:p-12">
      <h2 className="font-[450]! @min-[640px]:text-2xl @min-[768px]:text-3xl text-gray-1000 text-xl tracking-tighter">
        {title}
      </h2>
      <p className="mt-2 text-balance text-gray-800 text-lg">{description}</p>
    </div>
    <div className="@min-[640px]:col-span-2 @min-[640px]:p-12">{children}</div>
  </div>
);
