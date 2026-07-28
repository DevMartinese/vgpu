import Link from 'next/link';

const githubHref = 'https://github.com/vercel-labs/vgpu';

export function HomeHeader() {
  return (
    <header data-hero-overlay className="absolute top-0 z-30 w-full border-b border-white/10 bg-black/20 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 lg:px-12">
        <Link href="/" className="flex items-center gap-3">
          <svg className="h-3.5 w-3.5" viewBox="0 0 76 65" fill="white" aria-hidden="true">
            <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
          </svg>
          <span className="text-[15px] font-semibold text-gray-12">vgpu</span>
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-5 text-sm text-gray-9">
          <Link href="/docs" className="transition-colors hover:text-gray-12">Docs</Link>
          <Link href="/examples" className="transition-colors hover:text-gray-12">Examples</Link>
          <a href={githubHref} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-gray-12">
            GitHub
          </a>
        </nav>
      </div>
    </header>
  );
}
