'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Leaderboards } from './slipstream/Leaderboards';
import { Adoption } from './slipstream/Adoption';
import { LiveSettlement } from './slipstream/LiveSettlement';

// three.js is only pulled in when the Migration tab is actually opened.
const MigrationCloud = dynamic(() => import('./slipstream/MigrationCloud'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-[12px] text-[var(--text-muted)]">
      loading renderer…
    </div>
  ),
});

const TABS = [
  { id: 'live', label: 'Live' },
  { id: 'migration', label: 'Drift' },
  { id: 'leaderboards', label: 'Leaderboards' },
  { id: 'adoption', label: 'Adoption' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export function Slipstream({ windowId }: { windowId?: string }) {
  const [tab, setTab] = useState<TabId>('live');

  return (
    <div className="flex h-full flex-col gap-3">
      <nav className="flex shrink-0 flex-wrap gap-1 border-b border-[var(--border-window)] pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-[var(--radius-sm)] px-3 py-1.5 text-[13px] transition-colors ${
              tab === t.id
                ? 'bg-[var(--bg-inset)] text-[var(--accent-gold)]'
                : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className={tab === 'migration' ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto'}>
        {tab === 'migration' && <MigrationCloud />}
        {tab === 'leaderboards' && <Leaderboards />}
        {tab === 'adoption' && <Adoption />}
        {tab === 'live' && <LiveSettlement windowId={windowId} />}
      </div>
    </div>
  );
}

export default Slipstream;
