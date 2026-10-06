'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';

/**
 * System Debugger (sysop only): requests and errors through the backend over
 * the last hour, the busiest routes, and recent error logs. Route patterns and
 * timings only; the backend never keeps who made a request.
 */
type Data = {
  series: { t: string; requests: number; errors: number; avgMs: number }[];
  routes: { method: string; route: string; requests: number; errors: number; avgMs: number }[];
  errors: { at: string; route: string | null; status: number | null; message: string }[];
};

const POLL_MS = 10_000;
const box = 'border border-[var(--border-window)] bg-[var(--bg-inset)] p-3';

export default function SystemDebugger() {
  const token = useAuthStore((s) => s.sessionToken);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/debug', { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `${r.status}`); return j as Data; })
      .then((j) => { if (live) { setData(j); setError(null); } })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    void load();
    const t = setInterval(load, POLL_MS);
    return () => { live = false; clearInterval(t); };
  }, [token]);

  if (!data) return <div className="p-4 text-[var(--text-muted)]">{error ?? 'loading…'}</div>;

  const peak = Math.max(1, ...data.series.map((m) => m.requests));
  const total = data.series.reduce((n, m) => n + m.requests, 0);
  const failed = data.series.reduce((n, m) => n + m.errors, 0);
  const last = data.series[data.series.length - 1]!;

  return (
    <div className="h-full overflow-auto p-4 space-y-4 text-sm">
      <div className="flex flex-wrap gap-6">
        <span>Last hour: <b className="text-[var(--accent-gold)]">{total.toLocaleString()}</b> requests</span>
        <span>Server errors: <b className={failed ? 'text-[var(--accent-orange)]' : 'text-[var(--text-green)]'}>{failed}</b></span>
        <span>This minute: <b>{last.requests}</b> · avg {last.avgMs} ms</span>
        {error && <span className="text-[var(--accent-orange)]">{error} (retrying)</span>}
      </div>

      <div className={box}>
        <div className="mb-2 text-[var(--text-muted)]">Requests per minute, last 60 minutes (orange: server errors)</div>
        <svg viewBox="0 0 600 120" className="w-full h-32" preserveAspectRatio="none" role="img" aria-label="Requests per minute">
          {data.series.map((m, i) => {
            const h = (m.requests / peak) * 110, e = (m.errors / peak) * 110;
            return (
              <g key={m.t}>
                <title>{`${new Date(m.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}: ${m.requests} requests, ${m.errors} errors, ${m.avgMs} ms avg`}</title>
                <rect x={i * 10 + 1} y={120 - h} width={8} height={h} fill="var(--accent-gold)" opacity={0.75} />
                {m.errors > 0 && <rect x={i * 10 + 1} y={120 - e} width={8} height={e} fill="var(--accent-orange)" />}
              </g>
            );
          })}
        </svg>
        <div className="flex justify-between text-xs text-[var(--text-muted)]"><span>60 min ago</span><span>peak {peak}/min</span><span>now</span></div>
      </div>

      <div className={box}>
        <div className="mb-2 text-[var(--text-muted)]">Busiest routes, last hour</div>
        <table className="w-full text-xs tabular-nums">
          <thead><tr className="text-left text-[var(--text-muted)]"><th>Route</th><th className="text-right">Requests</th><th className="text-right">Errors</th><th className="text-right">Avg ms</th></tr></thead>
          <tbody>
            {data.routes.map((r) => (
              <tr key={`${r.method} ${r.route}`}>
                <td className="font-mono break-all pr-2">{r.method} {r.route}</td>
                <td className="text-right">{r.requests}</td>
                <td className={`text-right ${r.errors ? 'text-[var(--accent-orange)]' : ''}`}>{r.errors}</td>
                <td className="text-right">{r.avgMs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={box}>
        <div className="mb-2 text-[var(--text-muted)]">Recent error logs (newest first, scrubbed of IPs, addresses and keys)</div>
        {data.errors.length === 0
          ? <div className="text-[var(--text-green)]">No errors since the last restart.</div>
          : (
            <div className="max-h-72 overflow-auto font-mono text-xs space-y-1">
              {data.errors.map((e, i) => (
                <div key={`${e.at}-${i}`} className="break-all">
                  <span className="text-[var(--text-muted)]">{new Date(e.at).toLocaleTimeString()}</span>
                  {e.status ? <span className="text-[var(--accent-orange)]"> {e.status}</span> : null}
                  {e.route ? <span className="text-[var(--text-amber)]"> {e.route}</span> : null}
                  <span> {e.message}</span>
                </div>
              ))}
            </div>
          )}
      </div>
      <div className="text-xs text-[var(--text-muted)]">In memory on the backend: resets when it restarts. Refreshes every 10 seconds.</div>
    </div>
  );
}
