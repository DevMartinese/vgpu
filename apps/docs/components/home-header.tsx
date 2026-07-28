import Link from 'next/link';

const navLinks = [
  { href: '/docs/get-started', label: 'Get started' },
  { href: '/docs', label: 'Docs' },
  { href: '/examples', label: 'Examples' },
  { href: 'https://github.com/vercel-labs/vgpu', label: 'Github', external: true },
];

/**
 * Homepage header: wordmark left, nav right, floating straight on the shader.
 *
 * No bar, border or backdrop blur — the black hole has to read edge to edge, so
 * the chrome is only text. Marked `data-hero-overlay` so the tuning panel's
 * "hide UI" toggle drops it along with the rest of the hero copy.
 */
export function HomeHeader() {
  return (
    <header
      data-hero-overlay
      className="absolute inset-x-0 top-0 z-30 flex items-center justify-between px-6 py-6 lg:px-[46px] lg:py-[27px]"
    >
      <Link
        href="/"
        className="flex items-center gap-2 text-[14px] leading-none text-[#D9D9D9] transition-opacity hover:opacity-75 lg:text-[16px]"
      >
        <svg className="h-[10px] w-[12px]" viewBox="0 0 76 65" fill="currentColor" aria-hidden="true">
          <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
        </svg>
        <span>VGPU</span>
      </Link>
      <nav
        aria-label="Primary"
        className="flex items-center gap-3 text-[13px] leading-none text-white sm:gap-4 sm:text-[15px] lg:gap-5 lg:text-[16px]"
      >
        {navLinks.map(({ href, label, external }) =>
          // Github leaves the site, so it gets a plain anchor: next/link's
          // prefetch and client navigation buy nothing for an external URL.
          external ? (
            <a
              key={href}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="whitespace-nowrap transition-opacity hover:opacity-70"
            >
              {label}
            </a>
          ) : (
            <Link key={href} href={href} className="whitespace-nowrap transition-opacity hover:opacity-70">
              {label}
            </Link>
          )
        )}
      </nav>
    </header>
  );
}
