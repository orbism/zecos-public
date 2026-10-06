'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuthStore } from '@/store/authStore';
import { useWindowStore } from '@/store/windowStore';
import { useExplorerStore } from '@/store/explorerStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { AppLoader } from '@/components/ui/AppLoader';

interface Activity {
  id: string;
  app: string;
  category: string;
  type: string;
  status: string; // completed | refunded | failed
  title: string;
  detail?: string | null;
  amountIn?: string | null;
  symbolIn?: string | null;
  amountOut?: string | null;
  symbolOut?: string | null;
  originTx?: string | null;
  destTx?: string | null;
  createdAt: string;
}

const STATUS_COLOR: Record<string, string> = {
  completed: 'var(--accent-green)',
  refunded: 'var(--accent-orange)',
  failed: 'var(--accent-orange)',
};

function openTxInExplorer(hash: string) {
  const { windows, openWindow } = useWindowStore.getState();
  const { queueSearch } = useExplorerStore.getState();
  const size = { width: 860, height: 880 };
  const pos = calculateWindowPosition(windows, size, window.innerWidth, window.innerHeight);
  const id = `explorer-${Date.now()}`;
  openWindow({ id, type: 'explorer', title: 'Explorer', position: pos, size, minSize: { width: 500, height: 400 } });
  queueSearch(id, hash, 'transaction');
}

export function TransactionHistory() {
  const { sessionToken } = useAuthStore();
  const [acts, setActs] = useState<Activity[] | null>(null);
  const [cat, setCat] = useState('all');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    setErr('');
    try {
      const r = await fetch('/api/swap/activity?limit=100', { headers: { Authorization: `Bearer ${sessionToken}` } });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || `HTTP ${r.status}`); return; }
      setActs(j.activities ?? []);
    } catch {
      setErr('Backend unreachable');
    }
  }, [sessionToken]);

  useEffect(() => { load(); }, [load]);

  const categories = ['all', ...Array.from(new Set((acts ?? []).map(a => a.category)))];
  const shown = (acts ?? []).filter(a => cat === 'all' || a.category === cat);

  return (
    <div className="border border-[var(--border-window)] p-3 bg-[var(--bg-inset)]">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[var(--text-muted)] text-xs">TRANSACTION HISTORY</div>
        {categories.length > 1 && (
          <div className="flex gap-1">
            {categories.map(c => (
              <button
                key={c}
                onClick={() => setCat(c)}
                className={`text-xs px-2 py-0.5 border transition-colors ${
                  cat === c ? 'border-[var(--accent-gold)] text-[var(--accent-gold)]'
                            : 'border-[var(--border-window)] text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="text-[var(--accent-orange)] text-xs">{err}</div>}
      {!acts && !err && <div className="py-4"><AppLoader /></div>}
      {acts && shown.length === 0 && !err && (
        <div className="text-[var(--text-muted)] text-xs py-4 text-center">
          No transactions yet. Completed swaps and other on-chain actions show up here.
        </div>
      )}

      <div className="space-y-2">
        {shown.map(a => (
          <div key={a.id} className="border border-[var(--border-window)] p-2 bg-[var(--bg-window)]">
            <div className="flex items-start gap-2">
              <span
                className="mt-1 inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: STATUS_COLOR[a.status] ?? 'var(--text-muted)' }}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs text-[var(--text-primary)]">{a.title}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide border border-[var(--border-window)] px-1">
                    {a.category}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {new Date(a.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  {a.originTx && (
                    <button
                      onClick={() => openTxInExplorer(a.originTx!)}
                      className="text-[10px] text-[var(--accent-purple)] hover:text-[var(--accent-gold)]"
                    >
                      view tx ↗
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
