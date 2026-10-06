'use client';

import { useState } from 'react';
import type { ZimAvatar } from '@/store/zimStore';
import GenFace from './GenFace';

/** Built-in pictures: Kaze and Kazan in their moods, and the Pools mark. Ids are what the server stores. */
export const PRESETS: Record<string, { src: string; bg: string; label: string }> = {
  kaze: { src: '/kaze/kaze-4x.png', bg: '#1d3b5c', label: 'Kaze' },
  'kaze-happy': { src: '/kaze/kaze-happy-4x.png', bg: '#3d5c1d', label: 'Happy Kaze' },
  'kaze-sly': { src: '/kaze/kaze-sly-4x.png', bg: '#4a1d5c', label: 'Sly Kaze' },
  'kaze-shielded': { src: '/kaze/kaze-shielded-4x.png', bg: '#5c4a1d', label: 'Shielded Kaze' },
  'kaze-memo': { src: '/kaze/kaze-memo-4x.png', bg: '#5c1d2e', label: 'Memo Kaze' },
  kazan: { src: '/kazan/kazan-happy-4x.png', bg: '#5c1d0e', label: 'Kazan' },
  'kazan-wink': { src: '/kazan/kazan-wink-4x.png', bg: '#3a1d5c', label: 'Winking Kazan' },
  'kazan-angry': { src: '/kazan/kazan-angry-4x.png', bg: '#5c1d1d', label: 'Hot-headed Kazan' },
  'kazan-ded': { src: '/kazan/kazan-ded-4x.png', bg: '#2a2a2a', label: 'Ded Kazan' },
  pools: { src: '/pools/logo-128.png', bg: '#0c1622', label: 'Pools' },
};

/** A person's picture, square, whatever kind it is. */
export default function Avatar({ avatar, size = 40, online }: { avatar: ZimAvatar; size?: number; online?: boolean }) {
  // An upload that will not decode shows a generated face, never a broken-image icon.
  const [broken, setBroken] = useState<string | null>(null);
  const uploadOk = avatar.kind === 'upload' && broken !== avatar.data;
  const inner = uploadOk
    ? <img src={avatar.data} alt="" width={size} height={size} onError={() => setBroken(avatar.data)}
        style={{ display: 'block', objectFit: 'cover', width: size, height: size }} />
    : avatar.kind === 'upload'
      ? <GenFace seed={avatar.data.slice(-24)} size={size} />
    : avatar.kind === 'preset' && PRESETS[avatar.seed]
      ? (
        <span style={{ display: 'grid', placeItems: 'center', width: size, height: size, background: PRESETS[avatar.seed]!.bg }}>
          <img src={PRESETS[avatar.seed]!.src} alt="" style={{ width: '80%', height: '80%', objectFit: 'contain', imageRendering: 'pixelated' }} />
        </span>
      )
      : <GenFace seed={avatar.seed} size={size} />;
  return (
    <span style={{
      position: 'relative', display: 'inline-block', flexShrink: 0, width: size, height: size,
      borderRadius: Math.max(3, size * 0.12), overflow: 'hidden',
      boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.08), 0 0 0 1px rgba(0,0,0,.6)',
      filter: online === false ? 'grayscale(.85) brightness(.7)' : undefined,
    }}>
      {inner}
    </span>
  );
}
