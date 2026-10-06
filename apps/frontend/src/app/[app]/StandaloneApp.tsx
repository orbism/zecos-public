'use client';

import { getApp } from '@/config/appRegistry';
import { StandaloneShell } from '@/components/standalone/StandaloneShell';
import { TileHost } from '@/components/standalone/TileHost';

/**
 * Client boundary for the standalone route.
 *
 * The page is a Server Component (for metadata + static params), so the actual
 * app components - which are client-only - are resolved here by id.
 */
export function StandaloneApp({ id, mode }: { id: string; mode: 'simple' | 'tiled' }) {
  const config = getApp(id);
  if (!config?.component) return null;

  return mode === 'tiled' ? <TileHost config={config} /> : <StandaloneShell config={config} />;
}
