'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useExplorerStore } from '@/store/explorerStore';
import { useWindowStore } from '@/store/windowStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { AppLoader } from '@/components/ui/AppLoader';
import { copyText as clipboardCopy } from '@/utils/clipboard';

// Receiver type returned by the backend
interface Receiver {
  type: 'p2pkh' | 'p2sh' | 'sapling' | 'orchard' | string;
  address?: string;
  diversifiedTransmissionKey?: string;
  rawBytes?: string;
  [key: string]: unknown;
}

interface DecodeResult {
  address?: string;
  network?: string;
  valid?: boolean;
  type?: string;
  receivers?: Receiver[];
  error?: string;
  [key: string]: unknown;
}

/**
 * Receiver kind → the pool it belongs to.
 *
 * Ironwood (NU6.3) reused the Orchard receiver typecode instead of defining a
 * new one, so a decoded UA still reports an `orchard` receiver - correct about
 * the encoding, stale about the pool. Both are shown.
 *
 * `p2pkh` / `p2sh` are the wire names the backend uses for transparent
 * receivers; without entries here they fell through to the raw type string.
 */
const RECEIVER_LABELS: Record<string, { label: string; pool: string; color: string; icon: string; note?: string }> = {
  p2pkh:   { label: 'Transparent (P2PKH)', pool: 'Transparent', color: 'var(--text-amber)', icon: 'T' },
  p2sh:    { label: 'Transparent (P2SH)',  pool: 'Transparent', color: 'var(--text-amber)', icon: 'T' },
  sapling: { label: 'Sapling',             pool: 'Sapling',     color: 'var(--accent-purple)', icon: 'S' },
  orchard: {
    label: 'Orchard', pool: 'Ironwood', color: 'var(--accent-green)', icon: 'O',
    note: 'Still an Orchard-typecode receiver - Ironwood (NU6.3) reused it rather than defining a new one.',
  },
};

function metaFor(type: string) {
  return RECEIVER_LABELS[type] ?? { label: type, pool: '-', color: 'var(--text-green)', icon: '?' };
}

function truncate(s: string, n = 24): string {
  if (!s || s.length <= n) return s;
  return `${s.slice(0, n / 2)}…${s.slice(-n / 2)}`;
}

function copyText(s: string) {
  void clipboardCopy(s);
}

async function decodeAddress(addr: string): Promise<DecodeResult> {
  try {
    const res = await fetch(`/api/decode-address?address=${encodeURIComponent(addr)}`);
    const json = await res.json();
    if (!res.ok) return { error: json.error || `HTTP ${res.status}` };
    return json;
  } catch {
    return { error: 'Network error' };
  }
}

/**
 * A receiver's identity for comparison purposes.
 *
 * Transparent and Sapling receivers decode to their own standalone address, so
 * two UAs carrying the same one are provably the same key. Orchard receivers
 * have no standalone encoding - the backend echoes the whole UA back - so they
 * are opaque here and deliberately excluded rather than compared misleadingly.
 */
function receiverKey(r: Receiver, containingAddress: string): string | null {
  const raw = r.diversifiedTransmissionKey || r.rawBytes;
  if (raw) return `${r.type}:${raw}`;
  if (!r.address) return null;
  if (r.address === containingAddress && r.type === 'orchard') return null; // opaque
  return `${r.type}:${r.address}`;
}

function ReceiverRow({
  r, containing, onExplore,
}: { r: Receiver; containing: string; onExplore?: (addr: string) => void }) {
  const meta = metaFor(r.type);
  const displayValue = r.address || r.diversifiedTransmissionKey || r.rawBytes || '';
  const [rowCopied, setRowCopied] = useState(false);
  const opaque = receiverKey(r, containing) === null;

  const handleRowCopy = () => {
    copyText(displayValue);
    setRowCopied(true);
    setTimeout(() => setRowCopied(false), 1500);
  };

  return (
    <div className="border border-[var(--border-window)] p-3 bg-[var(--bg-inset)]">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span
          className="w-5 h-5 flex items-center justify-center text-xs font-bold border shrink-0"
          style={{ borderColor: meta.color, color: meta.color }}
        >
          {meta.icon}
        </span>
        <span className="text-xs font-bold" style={{ color: meta.color }}>{meta.label}</span>
        <span className="text-[10px] uppercase tracking-wide border border-[var(--border-window)] px-1.5 py-0.5 text-[var(--text-muted)]">
          pool <span className="text-[var(--accent-gold)]">{meta.pool}</span>
        </span>
        {r.address && onExplore && !opaque && (
          <button
            onClick={() => onExplore(r.address!)}
            className="ml-auto text-xs text-[var(--accent-purple)] hover:text-[var(--accent-gold)] border border-[var(--border-window)] px-2 py-0.5"
          >
            Explore ↗
          </button>
        )}
      </div>
      {meta.note && (
        <div className="mb-2 text-[11px] leading-relaxed text-[var(--text-muted)]">{meta.note}</div>
      )}
      {displayValue && (
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-green)] text-xs font-mono break-all flex-1 leading-relaxed">
            {displayValue}
          </span>
          <button
            onClick={handleRowCopy}
            className={`shrink-0 text-xs border border-[var(--border-window)] px-2 py-0.5 transition-colors ${
              rowCopied
                ? 'text-[var(--accent-green)] border-[var(--accent-green)]/50'
                : 'text-[var(--text-muted)] hover:text-[var(--accent-gold)]'
            }`}
          >
            {rowCopied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      )}
      {/* Extra fields for advanced display */}
      {Object.entries(r).filter(([k]) => !['type','address','diversifiedTransmissionKey','rawBytes'].includes(k)).map(([k, v]) => (
        <div key={k} className="mt-1 text-xs text-[var(--text-muted)]">
          <span className="text-[var(--text-amber)]">{k}:</span>{' '}
          <span className="font-mono">{String(v).slice(0, 80)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Decode tab ───────────────────────────────────────────────────────────────

function DecodePanel({ windowId }: { windowId?: string }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DecodeResult | null>(null);
  const [decoded, setDecoded] = useState('');   // the address the result belongs to
  const [copied, setCopied] = useState(false);
  const [copiedAddr, setCopiedAddr] = useState(false);

  // Consume queued address from Explorer "DECODE ↗" button
  const { consumeAction } = useExplorerStore();

  const decode = useCallback(async (addr: string) => {
    const q = addr.trim();
    if (!q) return;
    setLoading(true);
    setResult(null);
    setResult(await decodeAddress(q));
    setDecoded(q);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!windowId) return;
    const action = consumeAction(windowId);
    if (action?.mode === 'search' && action.query) {
      setInput(action.query);
      decode(action.query);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [windowId]);

  const handleSubmit = () => decode(input);

  const openInExplorer = (addr: string) => {
    const { windows, openWindow } = useWindowStore.getState();
    const { queueSearch } = useExplorerStore.getState();
    const pos = calculateWindowPosition(windows, { width: 700, height: 600 }, window.innerWidth, window.innerHeight);
    const id = `explorer-${Date.now()}`;
    openWindow({ id, type: 'explorer', title: 'Explorer', position: pos, size: { width: 700, height: 600 }, minSize: { width: 500, height: 400 } });
    queueSearch(id, addr, 't-address');
  };

  const copyAllJson = () => {
    if (!result) return;
    copyText(JSON.stringify(result, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const receivers: Receiver[] = result?.receivers ?? [];

  return (
    <div className="flex flex-col flex-1 min-h-0 p-3 gap-3">
      {/* Input row */}
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="Paste a Zcash address (u1…, t1…, zs1…)"
          className="flex-1 min-w-0 bg-[var(--bg-inset)] border border-[var(--border-window)] text-[var(--text-green)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-gold)]"
        />
        <button
          onClick={handleSubmit}
          disabled={loading || !input.trim()}
          className="btn-window px-4 py-2 text-[var(--accent-gold)] disabled:opacity-50"
        >
          {loading ? '…' : 'Decode'}
        </button>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto space-y-3">
        {!result && !loading && (
          <div className="text-[var(--text-muted)] text-xs text-center py-8 leading-relaxed">
            Enter any Zcash address to inspect its receiver components.<br />
            <span className="text-[var(--accent-gold)]">Unified Addresses</span> (u1…) may carry transparent,
            Sapling and Orchard receivers.
          </div>
        )}

        {loading && (
          <div className="py-8"><AppLoader /></div>
        )}

        {result?.error && (
          <div className="text-[var(--accent-orange)] border border-[var(--accent-orange)]/30 p-3">
            {result.error}
          </div>
        )}

        {result && !result.error && (
          <>
            {/* Address summary */}
            <div className="border border-[var(--accent-gold)]/30 bg-[var(--bg-inset)] p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[var(--accent-gold)] text-xs font-bold uppercase tracking-wide">
                  {result.type ?? (result.receivers?.length ? 'Unified Address' : 'Address')}
                </span>
                {result.network && (
                  <span className="text-xs text-[var(--text-muted)] border border-[var(--border-window)] px-2 py-0.5">
                    {result.network}
                  </span>
                )}
              </div>
              <div className="text-[var(--text-green)] text-xs break-all leading-relaxed">
                {result.address ?? decoded}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    copyText(result.address ?? decoded);
                    setCopiedAddr(true);
                    setTimeout(() => setCopiedAddr(false), 1500);
                  }}
                  className={`text-xs border border-[var(--border-window)] px-2 py-0.5 transition-colors ${
                    copiedAddr
                      ? 'text-[var(--accent-green)] border-[var(--accent-green)]/50'
                      : 'text-[var(--text-muted)] hover:text-[var(--accent-gold)]'
                  }`}
                >
                  {copiedAddr ? '✓ Copied' : 'Copy address'}
                </button>
                <button
                  onClick={copyAllJson}
                  className="text-xs border border-[var(--border-window)] text-[var(--text-muted)] hover:text-[var(--accent-gold)] px-2 py-0.5"
                >
                  {copied ? '✓ Copied' : 'Copy JSON'}
                </button>
              </div>
            </div>

            {/* Receivers */}
            {receivers.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[var(--text-muted)] text-xs uppercase tracking-wide">
                  {receivers.length} receiver{receivers.length !== 1 ? 's' : ''} found
                </div>
                {receivers.map((r, i) => (
                  <ReceiverRow
                    key={i}
                    r={r}
                    containing={result.address ?? decoded}
                    onExplore={r.address ? openInExplorer : undefined}
                  />
                ))}
              </div>
            ) : (
              // Non-UA address - show key fields
              <div className="space-y-2">
                {Object.entries(result)
                  .filter(([k]) => !['address','type','network','error','receivers'].includes(k))
                  .map(([k, v]) => (
                    <div key={k} className="border border-[var(--border-window)] p-2 text-xs flex gap-3">
                      <span className="text-[var(--text-amber)] w-32 shrink-0">{k}</span>
                      <span className="text-[var(--text-green)] font-mono break-all">{String(v).slice(0, 200)}</span>
                    </div>
                  ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Linkage tab ──────────────────────────────────────────────────────────────

interface LinkRow { input: string; result: DecodeResult | null }

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Do these addresses belong to the same wallet?
 *
 * Two different UA strings can wrap the very same transparent or Sapling
 * receiver - which is a hard, on-address proof they came from one account, with
 * no chain lookup involved. This finds those overlaps and groups the addresses
 * accordingly.
 */
function LinkagePanel() {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<LinkRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const addresses = useMemo(
    () => text.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 8),
    [text],
  );

  const run = useCallback(async () => {
    if (addresses.length < 2) return;
    setLoading(true);
    setRows(null);
    const results = await Promise.all(addresses.map(decodeAddress));
    setRows(addresses.map((input, i) => ({ input, result: results[i] })));
    setLoading(false);
  }, [addresses]);

  // key → indices of the addresses carrying it
  const shared = useMemo(() => {
    if (!rows) return [];
    const map = new Map<string, { r: Receiver; idx: number[] }>();
    rows.forEach((row, i) => {
      for (const r of row.result?.receivers ?? []) {
        const k = receiverKey(r, row.result?.address ?? row.input);
        if (!k) continue;
        const hit = map.get(k);
        if (hit) { if (!hit.idx.includes(i)) hit.idx.push(i); }
        else map.set(k, { r, idx: [i] });
      }
    });
    return [...map.values()].filter((v) => v.idx.length > 1);
  }, [rows]);

  // Addresses joined transitively by any shared receiver.
  const clusters = useMemo(() => {
    if (!rows) return [];
    const parent = rows.map((_, i) => i);
    const find = (a: number): number => (parent[a] === a ? a : (parent[a] = find(parent[a])));
    for (const s of shared) for (const i of s.idx.slice(1)) parent[find(i)] = find(s.idx[0]);
    const groups = new Map<number, number[]>();
    rows.forEach((_, i) => {
      const root = find(i);
      groups.set(root, [...(groups.get(root) ?? []), i]);
    });
    return [...groups.values()].filter((g) => g.length > 1);
  }, [rows, shared]);

  const opaqueCount = useMemo(() => {
    if (!rows) return 0;
    return rows.reduce((n, row) => n + (row.result?.receivers ?? []).filter(
      (r) => receiverKey(r, row.result?.address ?? row.input) === null,
    ).length, 0);
  }, [rows]);

  return (
    <div className="flex flex-col flex-1 min-h-0 p-3 gap-3">
      <div className="text-[11px] text-[var(--text-muted)] leading-relaxed">
        Paste 2-8 addresses (one per line). Any two that carry the same transparent or Sapling
        receiver are the same wallet - provable from the addresses alone, no chain lookup.
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        spellCheck={false}
        placeholder={'u1…\nu1…\nt1…'}
        className="w-full bg-[var(--bg-inset)] border border-[var(--border-window)] text-[var(--text-green)] px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:border-[var(--accent-gold)]"
      />
      <div className="flex items-center gap-2">
        <button
          onClick={run}
          disabled={loading || addresses.length < 2}
          className="btn-window px-4 py-2 text-[var(--accent-gold)] disabled:opacity-50"
        >
          {loading ? '…' : 'Compare'}
        </button>
        <span className="text-xs text-[var(--text-muted)]">
          {addresses.length} address{addresses.length === 1 ? '' : 'es'}
          {addresses.length < 2 ? ' - need at least 2' : ''}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3">
        {loading && <div className="py-8"><AppLoader /></div>}

        {rows && !loading && (
          <>
            {/* Verdict */}
            <div
              className="border p-3 text-xs leading-relaxed"
              style={{
                borderColor: clusters.length ? 'var(--accent-orange)' : 'var(--border-window)',
                color: clusters.length ? 'var(--accent-orange)' : 'var(--text-muted)',
              }}
            >
              {clusters.length ? (
                <>
                  <span className="font-bold uppercase tracking-wide">Linked</span>
                  {clusters.map((g, i) => (
                    <div key={i} className="mt-1">
                      {g.map((n) => LETTERS[n]).join(' + ')} share a receiver - same wallet.
                    </div>
                  ))}
                </>
              ) : (
                <><span className="font-bold uppercase tracking-wide">No linkage found</span> - these
                addresses share no comparable receiver.</>
              )}
              {opaqueCount > 0 && (
                <div className="mt-2 text-[var(--text-muted)]">
                  {opaqueCount} Orchard receiver{opaqueCount === 1 ? '' : 's'} skipped: they have no
                  standalone encoding, so they can neither confirm nor rule out a link.
                </div>
              )}
            </div>

            {/* Shared receivers */}
            {shared.length > 0 && (
              <div className="space-y-2">
                <div className="text-[var(--text-muted)] text-xs uppercase tracking-wide">
                  Shared receivers
                </div>
                {shared.map((s, i) => {
                  const meta = metaFor(s.r.type);
                  return (
                    <div key={i} className="border border-[var(--accent-orange)]/40 bg-[var(--bg-inset)] p-2 text-xs">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold" style={{ color: meta.color }}>{meta.label}</span>
                        <span className="text-[var(--accent-orange)]">
                          in {s.idx.map((n) => LETTERS[n]).join(', ')}
                        </span>
                      </div>
                      <div className="font-mono break-all text-[var(--text-green)]">
                        {s.r.address ?? s.r.diversifiedTransmissionKey ?? s.r.rawBytes}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Per-address breakdown */}
            <div className="space-y-2">
              <div className="text-[var(--text-muted)] text-xs uppercase tracking-wide">Addresses</div>
              {rows.map((row, i) => {
                const rec = row.result?.receivers ?? [];
                return (
                  <div key={i} className="border border-[var(--border-window)] bg-[var(--bg-inset)] p-2 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="w-5 h-5 flex items-center justify-center font-bold border border-[var(--accent-gold)] text-[var(--accent-gold)] shrink-0">
                        {LETTERS[i]}
                      </span>
                      <span className="font-mono text-[var(--text-green)]">{truncate(row.input, 30)}</span>
                      {row.result?.error && (
                        <span className="text-[var(--accent-orange)]">{row.result.error}</span>
                      )}
                      {rec.map((r, j) => {
                        const meta = metaFor(r.type);
                        const k = receiverKey(r, row.result?.address ?? row.input);
                        const isShared = !!k && shared.some((s) => s.idx.includes(i) && (s.r.address ?? s.r.diversifiedTransmissionKey ?? s.r.rawBytes) === (r.address ?? r.diversifiedTransmissionKey ?? r.rawBytes));
                        return (
                          <span
                            key={j}
                            className="border px-1.5 py-0.5 text-[10px] uppercase tracking-wide"
                            style={{
                              borderColor: isShared ? 'var(--accent-orange)' : 'var(--border-window)',
                              color: isShared ? 'var(--accent-orange)' : meta.color,
                            }}
                            title={k ? undefined : 'Opaque - not comparable'}
                          >
                            {meta.label}{k ? '' : ' ·opaque'}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Shell ────────────────────────────────────────────────────────────────────

type Tab = 'decode' | 'linkage';
const TABS: { id: Tab; label: string }[] = [
  { id: 'decode', label: 'Decode' },
  { id: 'linkage', label: 'Linkage' },
];

/**
 * Mounted in three places - the pre-login splash, a desktop window, and the
 * standalone `/ua-decoder` route - so everything lives inside this component
 * and no host has to opt features in. Both tabs stay mounted so switching back
 * doesn't discard a decode.
 */
export default function UaDecoder({ windowId }: { windowId?: string }) {
  const [tab, setTab] = useState<Tab>('decode');

  return (
    <div className="flex flex-col h-full bg-[var(--bg-window)] font-mono text-sm overflow-hidden">
      <div className="flex shrink-0 border-b border-[var(--border-window)]">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className="px-4 py-2 text-xs uppercase tracking-wide transition-colors"
            style={{
              color: tab === t.id ? 'var(--accent-gold)' : 'var(--text-muted)',
              borderBottom: `2px solid ${tab === t.id ? 'var(--accent-gold)' : 'transparent'}`,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-1 min-h-0" style={{ display: tab === 'decode' ? 'flex' : 'none' }}>
        <DecodePanel windowId={windowId} />
      </div>
      <div className="flex flex-1 min-h-0" style={{ display: tab === 'linkage' ? 'flex' : 'none' }}>
        <LinkagePanel />
      </div>
    </div>
  );
}
