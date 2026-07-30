'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { examplesMetadata } from '@/lib/examples-metadata';
import { Wordmark } from './wordmark';

export function ExamplesSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-72 border-r border-gray-4 bg-black lg:flex lg:flex-col">
      <div className="border-b border-gray-4 px-5 py-5">
        <Wordmark />
        <Link href="/docs" className="mt-3 inline-block text-sm text-gray-9 transition-colors hover:text-gray-12">
          Docs →
        </Link>
      </div>
      <nav aria-label="Examples" className="flex-1 overflow-y-auto p-3">
        <p className="px-2 pb-2 text-xs font-medium uppercase tracking-wider text-gray-8">Examples</p>
        <ul className="space-y-3">
          {examplesMetadata.map((example) => {
            const href = `/examples/${example.slug}`;
            const active = pathname === href;
            return (
              <li key={example.slug}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={`block rounded-md p-2 transition-colors ${
                    active ? 'bg-gray-2 text-gray-12' : 'text-gray-10 hover:bg-gray-1 hover:text-gray-12'
                  }`}
                >
                  <div className="relative aspect-video w-full overflow-hidden rounded border border-gray-4 bg-gray-1">
                    {example.thumbnail ? <img src={example.thumbnail} alt="" className="h-full w-full object-cover" /> : null}
                  </div>
                  <span className="mt-2 block truncate text-sm">{example.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
