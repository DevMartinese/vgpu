import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The vgpu wordmark: triangle plus name, linking home.
 *
 * One definition on purpose. The homepage header used to carry its own copy — a
 * 12x10 triangle beside regular-weight "VGPU" — and against the sidebars' 14x14
 * semibold "vgpu" it read as a thinner, weaker logo rather than the same brand.
 * The sidebar treatment won, so it lives here and the three call sites share it
 * verbatim. Any change to the mark belongs in this file.
 *
 * Deliberately not a client component: it holds no state, so it renders on the
 * server in the homepage header and is pulled into the client bundle only where
 * a client sidebar imports it.
 */
export function Wordmark({
  href = '/',
  className = '',
  onClick,
  children,
}: {
  /** Link destination. Home everywhere today. */
  href?: string;
  /**
   * Extra classes for the link box only — spacing and hover belong to the call
   * site. Type, colour and the triangle are the mark itself and are not
   * overridable, which is the entire point of this component.
   */
  className?: string;
  onClick?: () => void;
  /** Sits inside the link, after the name — the docs sidebar's "Docs" pill. */
  children?: ReactNode;
}) {
  return (
    <Link href={href} onClick={onClick} className={`flex items-center gap-3 ${className}`.trimEnd()}>
      <svg className="h-3.5 w-3.5" viewBox="0 0 76 65" fill="white" aria-hidden="true">
        <path d="M37.5274 0L75.0548 65H0L37.5274 0Z" />
      </svg>
      <span className="text-[15px] font-semibold text-gray-12">vgpu</span>
      {children}
    </Link>
  );
}
