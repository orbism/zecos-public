'use client';

import { useSystemDialogStore } from '@/store/systemDialogStore';

// Renders the front of the system-dialog queue as a centered CGA-style modal.
// Mounted once globally (in Desktop). z-index sits above windows + CoffeeCup.
export function SystemDialog() {
  const { queue, dismiss } = useSystemDialogStore();
  const dlg = queue[0];
  if (!dlg) return null;

  const toneColor =
    dlg.tone === 'warn' ? 'var(--accent-orange)'
    : dlg.tone === 'success' ? 'var(--accent-green)'
    : 'var(--accent-gold)';

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50"
      onClick={() => dismiss(dlg.id)}
    >
      <div
        className="bg-[var(--bg-window)] border-2 shadow-2xl w-[380px] max-w-[92vw] font-mono"
        style={{ borderColor: toneColor }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="px-3 py-2 text-xs font-bold uppercase tracking-wide border-b"
          style={{ color: toneColor, borderColor: 'var(--border-window)' }}
        >
          {dlg.title}
        </div>
        <div className="p-4 text-sm text-[var(--text-green)] leading-relaxed whitespace-pre-line">
          {dlg.message}
        </div>
        {dlg.details && dlg.details.length > 0 && (
          <div className="mx-4 mb-3 rounded-sm border border-[var(--border-window)] bg-[#0a0c14] divide-y divide-[var(--border-window)]/60">
            {dlg.details.map((d, i) => {
              const mono = d.mono ? 'font-mono' : '';
              const strong = d.strong ? 'font-bold' : '';
              return (
                <div key={i} className="flex items-center justify-between gap-3 px-2.5 py-1.5 text-[11px]">
                  <span className="text-[var(--text-muted)] shrink-0">{d.label}</span>
                  {d.href ? (
                    <a href={d.href} target="_blank" rel="noopener noreferrer"
                       className={`text-[var(--accent-purple)] hover:text-[var(--accent-gold)] break-all text-right ${mono} ${strong}`}>
                      {d.value} {d.icon ?? '↗'}
                    </a>
                  ) : d.onClick ? (
                    <button onClick={d.onClick}
                       className={`text-[var(--accent-purple)] hover:text-[var(--accent-gold)] break-all text-right ${mono} ${strong}`}>
                      {d.value} {d.icon ?? ''}
                    </button>
                  ) : (
                    <span className={`text-[var(--text-green)] break-all text-right ${mono} ${strong}`}>{d.value}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="flex justify-end gap-2 px-4 pb-4">
          {(dlg.actions ?? [{ label: 'OK' }]).map((a, i) => (
            <button
              key={i}
              onClick={() => { a.onClick?.(); dismiss(dlg.id); }}
              className={`btn-window px-3 py-1.5 text-xs ${
                a.primary ? 'text-[var(--accent-gold)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
