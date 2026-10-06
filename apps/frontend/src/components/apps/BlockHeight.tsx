'use client';

import { useStatus } from '@/hooks/useZecData';
import { AppLoader } from '@/components/ui/AppLoader';
import { GlyphStat } from '@/lib/generative/GlyphStat';

export function BlockHeight() {
  const { data, loading, error } = useStatus();

  const height = data?.height;

  return (
    <GlyphStat value={height} accent="--accent-gold" label="Block height">
      <div className="flex flex-col h-full justify-center items-center">
        {loading && !data ? (
          <AppLoader />
        ) : error ? (
          <span className="text-[var(--accent-orange)]" style={{ fontSize: 'var(--font-size-label)' }}>Error</span>
        ) : (
          <>
            <div
              className="text-[var(--accent-gold)]"
              style={{ fontFamily: 'var(--font-vt323)', fontSize: 'var(--font-size-value)' }}
            >
              {height?.toLocaleString() ?? '-'}
            </div>
            <div className="text-[var(--text-green)] mt-1" style={{ fontSize: 'var(--font-size-label)' }}>
              Block Height
            </div>
          </>
        )}
      </div>
    </GlyphStat>
  );
}
