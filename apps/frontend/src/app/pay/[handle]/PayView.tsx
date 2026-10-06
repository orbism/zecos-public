'use client';

import { useEffect, useState } from 'react';
import { PayCard, type PayPageData } from '@/components/pay/PayCard';

export default function PayView({ handle }: { handle: string }) {
  const [state, setState] = useState<{ page: PayPageData; name: string } | 'missing' | null>(null);
  useEffect(() => {
    void fetch(`/api/pay/${encodeURIComponent(handle)}`)
      .then(async (r) => (r.ok ? r.json() : null))
      .then((j) => setState(j?.page ? { page: j.page, name: j.name ?? handle } : 'missing'))
      .catch(() => setState('missing'));
  }, [handle]);
  return (
    <main className="min-h-screen w-full flex justify-center" style={{ background: 'var(--bg-window)', color: 'var(--text-primary)', padding: '32px 16px' }}>
      <div style={{ width: '100%', maxWidth: 620 }}>
        <a href="/" className="text-[var(--accent-gold)]" style={{ fontFamily: 'var(--font-display)', fontSize: 14 }}>ZEC-OS</a>
        <div style={{ height: 16 }} />
        {state === null && <div className="text-[var(--text-muted)]">Loading...</div>}
        {state === 'missing' && <div className="text-[var(--text-secondary)]">There is no Pay Me page at this address.</div>}
        {state && state !== 'missing' && <PayCard page={state.page} name={state.name} />}
      </div>
    </main>
  );
}
