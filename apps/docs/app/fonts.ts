import localFont from 'next/font/local';

/**
 * Geist Serif — the homepage display face.
 *
 * Exposed as a CSS variable (not just `.className`) because the homepage sets
 * it on one wrapper and every child inherits it through Tailwind's `font-serif`
 * utility, including components that live in their own files (the header, the
 * hero tabs). Code fragments opt back out with `font-mono`.
 */
export const geistSerif = localFont({
  src: './fonts/GeistSerifV0.2-Regular.otf',
  display: 'swap',
  variable: '--font-geist-serif',
});
