interface TextGridSectionProps {
  data: {
    id: string;
    title: string;
    description: string;
  }[];
}

export const TextGridSection = ({ data }: TextGridSectionProps) => (
  <div className="grid @min-[768px]:grid-cols-3 gap-8 @min-[640px]:px-12 px-4 @min-[640px]:py-12 py-8">
    {data.map((item) => (
      <div key={item.id}>
        <h3 className="mb-2 font-[450] text-gray-1000 text-lg tracking-tight">
          {item.title}
        </h3>
        <p className="text-gray-800">{item.description}</p>
      </div>
    ))}
  </div>
);
