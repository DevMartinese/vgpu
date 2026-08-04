import Image from "next/image";
import { cn } from "@/lib/utils";

interface TemplatesProps {
  data: {
    title: string;
    description: string;
    link: string;
    image: string;
  }[];
  description: string;
  title: string;
}

export const Templates = ({ title, description, data }: TemplatesProps) => (
  <div className="grid gap-12 @min-[640px]:p-12 p-8 @min-[640px]:px-12 px-4 @min-[640px]:py-12 py-8">
    <div className="grid max-w-3xl gap-2 text-balance">
      <h2 className="font-[450]! @min-[1024px]:text-[40px] @min-[640px]:text-2xl @min-[768px]:text-3xl text-gray-1000 text-xl tracking-tighter">
        {title}
      </h2>
      <p className="text-balance text-gray-800 text-lg">{description}</p>
    </div>
    <div className="grid @min-[768px]:grid-cols-3 gap-8">
      {data.map((item) => (
        <a
          className="group flex-col overflow-hidden rounded-lg border bg-background-100 p-4"
          href={item.link}
          key={item.title}
        >
          <h3 className="font-[450] tracking-tight">{item.title}</h3>
          <p className="line-clamp-2 text-gray-800 text-sm">
            {item.description}
          </p>
          <Image
            alt={item.title}
            className={cn(
              "mt-8 -mb-12 ml-7 aspect-video -rotate-3 overflow-hidden rounded-md border object-cover object-top",
              "transition-transform duration-300 group-hover:-rotate-1 group-hover:scale-105"
            )}
            height={336}
            src={item.image}
            width={640}
          />
        </a>
      ))}
    </div>
  </div>
);
