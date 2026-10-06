'use client';

import { useStatus } from '@/hooks/useZecData';
import { shieldedPct } from '@/config/pools';
import { AppLoader } from '@/components/ui/AppLoader';
import { GlyphStat } from '@/lib/generative/GlyphStat';

export function ShieldedPercent() {
  const { data, loading, error } = useStatus();

  const pools = data?.pools;
  // shieldedPct includes ironwood in the numerator and lockbox only in supply.
  const shieldedPercent = shieldedPct(pools);

  return (
    <GlyphStat value={shieldedPercent} accent="#00cc66" label="Shielded percent">
      <div className="flex flex-col h-full justify-center items-center p-4">
        {loading && !data ? (
          <AppLoader />
        ) : error ? (
          <span className="text-[var(--accent-orange)]" style={{ fontSize: 'var(--font-size-label)' }}>Error</span>
        ) : (
          <div className="text-center">
            {/* Percentage */}
            <div
              className="text-[var(--accent-green)]"
              style={{ fontFamily: 'var(--font-vt323)', fontSize: 'var(--font-size-value)' }}
            >
              {shieldedPercent.toFixed(1)}%
            </div>
            <div className="text-[var(--text-green)] mt-1" style={{ fontSize: 'var(--font-size-label)' }}>
              Shielded
            </div>

            {/* Visual bar */}
            <div className="mt-4 w-full max-w-48 mx-auto">
              <div className="h-4 bg-[var(--bg-window)] border border-[var(--border-window)] rounded overflow-hidden">
                <div
                  className="h-full bg-[var(--accent-green)] transition-all duration-500"
                  style={{ width: `${shieldedPercent}%` }}
                />
              </div>
              <div className="flex justify-between mt-1 text-[var(--text-amber)] opacity-70" style={{ fontSize: 'var(--font-size-button)' }}>
                <span>0%</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </GlyphStat>
  );
}
