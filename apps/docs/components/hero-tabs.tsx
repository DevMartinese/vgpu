'use client';

import { useState } from 'react';
import { Card } from './card';
import { CopyButton } from './copy-button';

const tabContent = {
  Prompt: 'Add vgpu to my project, run npx vgpu docs to get started',
  Skill: 'npx skills add vercel-labs/vgpu',
} as const;

type Tab = keyof typeof tabContent;

export function HeroTabs() {
  const [activeTab, setActiveTab] = useState<Tab>('Prompt');
  const content = tabContent[activeTab];

  return (
    <Card className="w-full max-w-xl mx-auto text-left rounded-lg border border-gray-4 bg-gray-1 overflow-hidden">
      <Card.Header className="border-gray-4 bg-gray-2">
        <div className="flex gap-1" role="tablist" aria-label="Installation option">
          {(Object.keys(tabContent) as Tab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`h-7 rounded-md px-2 text-sm font-medium leading-5 transition-colors ${
                activeTab === tab
                  ? 'bg-gray-1 text-gray-12 shadow-sm'
                  : 'text-gray-9 hover:text-gray-12'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <CopyButton code={content} />
      </Card.Header>
      <Card.Body className="px-4 py-3 font-mono text-sm leading-6 text-gray-12">
        <code>{content}</code>
      </Card.Body>
    </Card>
  );
}
