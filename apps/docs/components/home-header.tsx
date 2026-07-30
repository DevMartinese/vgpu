import Link from 'next/link';
import { Wordmark } from './wordmark';

const navLinks = [
  // No "Docs" entry: /docs redirects to /docs/get-started, so it landed on the
  // exact same page as "Get started".
  { href: '/docs/get-started', label: 'Get started' },
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
      {/* The shared mark, identical to the docs and examples sidebars. This
          header used to roll its own lighter, smaller variant, which read as a
          different logo the moment you navigated. */}
      <Wordmark className="transition-opacity hover:opacity-75" />
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
