'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';

const MAX_BODY = 500;

const TOPICS: { id: string; label: string }[] = [
  { id: 'suggestion', label: 'Suggestion' },
  { id: 'bug',        label: 'Bug' },
  { id: 'collab',     label: 'Collab' },
  { id: 'other',      label: 'Other' },
];

export const C = {
  edge: '#00AAAA', bar: '#0000AA', title: '#FFFF55',
  text: '#AAAAAA', dim: '#888888', bright: '#55FFFF',
  green: '#55FF55', red: '#FF5555', bg: '#060606', inset: '#001a00',
};

const field: React.CSSProperties = {
  width: '100%', background: '#0b0b0b', border: `1px solid ${C.edge}`,
  color: C.green, padding: '6px 8px', fontFamily: 'monospace',
  fontSize: 'var(--font-size-trinket)', outline: 'none',
};

/**
 * The feedback form itself, with no surrounding chrome - it fills whatever
 * container it's given. Two hosts use it: `FeedbackModal` (a portalled blocking
 * overlay, for standalone routes) and `apps/Feedback` (an ordinary draggable,
 * resizable OS window on the desktop).
 *
 * The human check is issued and graded server-side and is single-use, so a
 * failed attempt burns it - every failure refetches a fresh one, except a
 * "too fast" rejection, which the server tells us to keep.
 */
export function FeedbackForm({ onDone }: { onDone?: () => void }) {
  // Sent when present purely so the sysop sees who wrote in - the endpoint is
  // public and a note from a signed-out visitor is just as welcome.
  const sessionToken = useAuthStore((s) => s.sessionToken);
  const [topic, setTopic] = useState('suggestion');
  const [email, setEmail] = useState('');
  const [discord, setDiscord] = useState('');
  const [twitter, setTwitter] = useState('');
  const [body, setBody] = useState('');
  const [answer, setAnswer] = useState('');
  const [challenge, setChallenge] = useState<{ id: string; question: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const loadChallenge = useCallback(async () => {
    setChallenge(null);
    setAnswer('');
    try {
      const res = await fetch('/api/feedback/challenge', { cache: 'no-store' });
      const d = await res.json();
      if (d?.id) setChallenge(d);
    } catch { /* the submit button stays disabled until one arrives */ }
  }, []);

  useEffect(() => { loadChallenge(); }, [loadChallenge]);

  const submit = async () => {
    if (!challenge || !body.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({
          challengeId: challenge.id, answer,
          topic, body: body.trim(), email, discord, twitter,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d?.error ?? `Something broke (HTTP ${res.status}).`);
        // The server says whether the challenge it holds survived the attempt -
        // a "too fast" rejection keeps it, so don't make them answer a new one.
        if (!d?.keepChallenge) loadChallenge();
      } else {
        setSent(true);
      }
    } catch {
      setError('Could not reach the server. Try again in a bit.');
      loadChallenge();
    } finally {
      setSending(false);
    }
  };

  const remaining = MAX_BODY - body.length;

  return (
    <div
      style={{
        padding: '14px 16px 18px', color: C.text, height: '100%', overflowY: 'auto',
        background: C.bg, fontFamily: 'monospace',
        fontSize: 'var(--font-size-trinket)', lineHeight: 1.7,
      }}
    >
      {sent ? (
        <>
          <p style={{ color: C.bright, marginBottom: 8 }}>Received. It&apos;s in the pile. 📬</p>
          <p style={{ marginBottom: 12, color: C.dim }}>
            The pile is read. The pile is loved. The pile is worked through at the speed of exactly
            one human who also has to sleep occasionally. Thank you for caring enough to type.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => { setSent(false); setBody(''); setError(null); loadChallenge(); }}
              style={{
                background: 'none', border: `1px solid ${C.edge}`, color: C.text,
                padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace',
                fontSize: 'var(--font-size-trinket)',
              }}
            >
              Send another
            </button>
            {onDone && (
              <button onClick={onDone} style={{
                background: 'none', border: `1px solid ${C.edge}`, color: C.bright,
                padding: '6px 14px', cursor: 'pointer', fontFamily: 'monospace',
                fontSize: 'var(--font-size-trinket)',
              }}>Close</button>
            )}
          </div>
        </>
      ) : (
        <>
          <p style={{ color: C.bright, marginBottom: 6 }}>Found a bug? Got an idea? Want to build something?</p>
          <p style={{ marginBottom: 14, color: C.dim }}>
            Fair warning: ZEC-OS is a one-person passion project running on coffee and stubbornness.
            Everything here gets read. Everything good gets built. &quot;Eventually&quot; is doing some
            heavy lifting in that sentence - thanks for your patience.
          </p>

          {/* Topic */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: C.title, marginBottom: 5 }}>What&apos;s this about?</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {TOPICS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTopic(t.id)}
                  style={{
                    background: topic === t.id ? C.bar : 'transparent',
                    border: `1px solid ${topic === t.id ? C.bright : C.edge}`,
                    color: topic === t.id ? C.title : C.text,
                    padding: '4px 10px', cursor: 'pointer',
                    fontFamily: 'monospace', fontSize: 'var(--font-size-trinket)',
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ color: C.title }}>Say your piece</span>
              <span style={{ color: remaining < 0 ? C.red : remaining < 60 ? C.title : C.dim }}>
                {remaining}
              </span>
            </div>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
              rows={5}
              maxLength={MAX_BODY}
              placeholder="500 characters. Brevity is a virtue and also a hard limit."
              style={{ ...field, resize: 'none', lineHeight: 1.6 }}
            />
          </div>

          {/* Contact */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ color: C.title, marginBottom: 2 }}>How do I reach you? (all optional)</div>
            <div style={{ color: C.dim, marginBottom: 6 }}>
              Leave it all blank and stay a mystery - just know I can&apos;t reply to a ghost.
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input value={email}   onChange={(e) => setEmail(e.target.value)}   placeholder="email" style={field} />
              <input value={discord} onChange={(e) => setDiscord(e.target.value)} placeholder="discord username" style={field} />
              <input value={twitter} onChange={(e) => setTwitter(e.target.value)} placeholder="x / twitter handle" style={field} />
            </div>
          </div>

          {/* Human check */}
          <div style={{ marginBottom: 12, border: `1px solid ${C.edge}`, padding: '8px 10px', background: C.inset }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ color: C.title }}>Prove you&apos;re carbon-based</span>
              <button
                onClick={loadChallenge}
                title="Different question, please"
                style={{
                  background: 'none', border: 'none', color: C.edge, cursor: 'pointer',
                  fontFamily: 'monospace', fontSize: 'var(--font-size-trinket)',
                }}
              >
                ↻ swap
              </button>
            </div>
            <div style={{ color: C.text, margin: '4px 0 6px' }}>
              {challenge ? challenge.question : 'thinking of a question…'}
            </div>
            <input
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              placeholder="your answer"
              style={field}
            />
          </div>

          {error && (
            <div style={{ color: C.red, border: `1px solid ${C.red}`, padding: '6px 8px', marginBottom: 10 }}>
              {error}
            </div>
          )}

          <button
            onClick={submit}
            disabled={sending || !challenge || !body.trim() || !answer.trim()}
            style={{
              background: 'none', border: `1px solid ${C.edge}`,
              color: sending || !body.trim() || !answer.trim() ? C.dim : C.bright,
              padding: '7px 16px', cursor: sending ? 'wait' : 'pointer',
              fontFamily: 'monospace', fontSize: 'var(--font-size-trinket)',
              opacity: !challenge || !body.trim() || !answer.trim() ? 0.55 : 1,
            }}
          >
            {sending ? 'sending…' : 'Send it →'}
          </button>
        </>
      )}
    </div>
  );
}
