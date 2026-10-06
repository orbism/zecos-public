'use client';

import { useState } from 'react';

/**
 * A message body with its links made clickable - and every click asked about.
 *
 * Only http(s) links and "www." hosts become links, so nothing else a person
 * types (javascript:, data:, a bare word with a dot) can ever be followed. A
 * click never navigates on its own: it opens a warning that shows where the
 * link REALLY goes. The host is shown as the browser will resolve it (punycode
 * for look-alike characters), because the text of a message can say anything.
 */

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
// Punctuation that ends a sentence rather than the link.
const TRAIL = /[.,;:!?'"]+$/;

type Part = { text: string } | { text: string; url: URL };

function parse(body: string): Part[] {
  const parts: Part[] = [];
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    let raw = m[0];
    const trail = raw.match(TRAIL)?.[0] ?? '';
    raw = raw.slice(0, raw.length - trail.length);
    // A closing bracket belongs to the link only if the link opened one.
    while (/[)\]]$/.test(raw) && (raw.split('(').length < raw.split(')').length || raw.split('[').length < raw.split(']').length)) raw = raw.slice(0, -1);
    let url: URL | null = null;
    try { url = new URL(/^www\./i.test(raw) ? `https://${raw}` : raw); } catch { url = null; }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) continue;
    const start = m.index ?? 0;
    if (start > last) parts.push({ text: body.slice(last, start) });
    parts.push({ text: raw, url });
    last = start + raw.length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

export default function MessageText({ body, linkColor }: { body: string; linkColor: string }) {
  const [pending, setPending] = useState<URL | null>(null);
  return (
    <>
      {parse(body).map((p, i) => ('url' in p ? (
        <button key={i} type="button" onClick={() => setPending(p.url)} title={`External link: ${p.url.hostname}`}
          style={{ background: 'none', border: 'none', padding: 0, font: 'inherit', color: linkColor,
            textDecoration: 'underline', textUnderlineOffset: 2, cursor: 'pointer', wordBreak: 'break-all', textAlign: 'left' }}>
          {p.text}
        </button>
      ) : <span key={i}>{p.text}</span>))}
      {pending && <LinkWarning url={pending} onClose={() => setPending(null)} />}
    </>
  );
}

/** Centred over the chat window. Asked every time; never remembered. */
function LinkWarning({ url, onClose }: { url: URL; onClose: () => void }) {
  const open = () => { window.open(url.href, '_blank', 'noopener,noreferrer'); onClose(); };
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="zim-link-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
      onClick={onClose}
      style={{ position: 'absolute', inset: 0, zIndex: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,.55)', padding: 16, whiteSpace: 'normal', wordBreak: 'normal' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 380, background: 'var(--bg-window)', color: 'var(--text-primary)',
          border: '1px solid var(--border-window)', borderTop: '3px solid #F4B728', borderRadius: 6, padding: 14,
          boxShadow: '0 10px 30px rgba(0,0,0,.5)', fontSize: 13, lineHeight: 1.5 }}>
        <div id="zim-link-title" style={{ fontWeight: 800, fontSize: 14, marginBottom: 6 }}>You are leaving ZEC-OS</div>
        <p style={{ margin: '0 0 8px' }}>
          This link was sent in a message and goes to a site outside ZEC-OS. We can&apos;t vouch for it or for what it
          asks of you. Never enter a seed phrase, spending key or password on a site you reached from a message.
        </p>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>It goes to</div>
        <div style={{ fontWeight: 800, fontSize: 14, margin: '2px 0 4px', wordBreak: 'break-all' }}>{url.hostname}</div>
        <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 11.5, color: 'var(--text-muted)', wordBreak: 'break-all',
          maxHeight: 64, overflowY: 'auto', background: 'var(--bg-inset)', padding: '4px 6px', borderRadius: 4 }}>{url.href}</div>
        {url.protocol === 'http:' && (
          <div style={{ marginTop: 6, color: 'var(--accent-orange)', fontSize: 12 }}>Not encrypted (http): anything you send there can be read on the way.</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button type="button" onClick={onClose} autoFocus
            style={{ font: 'inherit', padding: '5px 12px', borderRadius: 4, border: '1px solid var(--border-window)', background: 'var(--bg-inset)', color: 'var(--text-primary)', cursor: 'pointer' }}>
            Stay here
          </button>
          <button type="button" onClick={open}
            style={{ font: 'inherit', fontWeight: 700, padding: '5px 12px', borderRadius: 4, border: '1px solid #F4B728', background: 'transparent', color: '#F4B728', cursor: 'pointer' }}>
            Open link
          </button>
        </div>
      </div>
    </div>
  );
}
