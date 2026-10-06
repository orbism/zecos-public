'use client';

import { useEffect, useRef, useState } from 'react';
import { ZecQr } from '@/components/ui/ZecQr';
import { copyText } from '@/utils/clipboard';

/**
 * Link a testnet address to this account.
 *
 * Accounts are created from mainnet addresses only. On a testnet deployment a
 * verified account would otherwise have no proven address there, so it cuts and
 * buys by naming one at the guest rate. Proving a testnet address here makes it
 * the account's own on testnet: used automatically, verified rate.
 *
 * The proof is the same one login uses for shielded addresses: send a small
 * amount with a memo, the server replies with a code as a memo to the address
 * being linked, type the code back. That shows you can read that address's
 * memos, which is what controlling it means. Transparent addresses cannot
 * receive the code, so only shielded testnet addresses are accepted.
 *
 * Shown only when Pools is on testnet or an address is already linked - on a
 * mainnet-only deployment it would be a section about nothing.
 */

interface Challenge {
  nonce: string;
  zip321: string;
  valueZEC: string;
  toAddress: string;
  memoText: string;
  expiresAt: number;
  status?: string;
}

type Phase = 'idle' | 'paying' | 'code' | 'expired';

/** Two wallet processes per check, and this is rare: no reason to go faster. */
const POLL_MS = 10_000;

export function TestnetLink({
  token, linked, onLinked,
}: {
  token: string;
  linked: string | null;
  onLinked: (address: string) => void;
}) {
  const [onTestnet, setOnTestnet] = useState<boolean | null>(null);
  const [editing, setEditing] = useState(false);
  const [address, setAddress] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const polling = useRef(false);

  useEffect(() => {
    fetch('/api/rings/status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setOnTestnet(j?.network === 'testnet'))
      .catch(() => setOnTestnet(false));
  }, []);

  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Watch for the payment, then for the code to have been sent.
  useEffect(() => {
    if (!challenge || phase !== 'paying') return;
    let live = true;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const r = await fetch(`/api/auth/link-testnet/${challenge.nonce}`, { headers: auth, cache: 'no-store' });
        const j = await r.json();
        if (!live) return;
        if (j.status === 'linked' && j.testnetAddress) { finish(j.testnetAddress); return; }
        if (j.status === 'code_sent') { setPhase('code'); setMsg({ text: 'Payment seen. A code is on its way to that address as a memo.', ok: true }); }
        if (j.status === 'expired') setPhase('expired');
        if (!r.ok && j.error) setMsg({ text: j.error, ok: false });
      } catch {
        // Cannot see it from here right now; the next tick tries again.
      } finally {
        polling.current = false;
      }
    };
    void tick();
    const t = setInterval(() => void tick(), POLL_MS);
    return () => { live = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge, phase]);

  const finish = (addr: string) => {
    onLinked(addr);
    setChallenge(null); setPhase('idle'); setEditing(false); setAddress(''); setCode('');
    setMsg({ text: 'Linked ✓ - this address is now yours on testnet.', ok: true });
  };

  const start = async () => {
    setMsg(null); setBusy(true);
    try {
      const r = await fetch('/api/auth/link-testnet', {
        method: 'POST', headers: auth, body: JSON.stringify({ address: address.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error ?? `HTTP ${r.status}`, ok: false }); return; }
      if (j.linked) { finish(j.testnetAddress); return; }
      setChallenge(j);
      setPhase(j.status === 'code_sent' ? 'code' : 'paying');
    } catch {
      setMsg({ text: 'Backend unreachable', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!challenge) return;
    setMsg(null); setBusy(true);
    try {
      const r = await fetch('/api/auth/link-testnet/verify-code', {
        method: 'POST', headers: auth, body: JSON.stringify({ nonce: challenge.nonce, code: code.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error ?? `HTTP ${r.status}`, ok: false }); return; }
      finish(j.testnetAddress);
    } catch {
      setMsg({ text: 'Backend unreachable', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    if (await copyText(text)) { setCopied(label); setTimeout(() => setCopied(null), 1600); }
  };

  if (!onTestnet && !linked) return null;

  const input = 'bg-[var(--bg-window)] border border-[var(--border-window)] text-[var(--text-primary)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-gold)]';
  const showForm = !linked || editing;

  return (
    <div className="border border-[var(--border-window)] p-3 bg-[var(--bg-inset)]">
      <div className="text-[var(--text-muted)] text-xs mb-1">TESTNET ADDRESS</div>
      <div className="text-[var(--text-muted)] text-xs mb-3 leading-relaxed">
        {linked
          ? 'Proven and linked. On testnet this account cuts and buys with it automatically, at your verified rate.'
          : 'Your verified address is a mainnet address. Prove a shielded testnet address to cut and buy on testnet as yourself, at your verified rate. Without one you can still acquire on testnet by naming an address, at the guest rate.'}
      </div>

      {linked && !editing && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[var(--accent-gold)] text-xs break-all">{linked}</span>
          <button onClick={() => { setEditing(true); setMsg(null); }} className="btn-window px-3 py-1.5 text-xs text-[var(--accent-gold)]">
            Replace
          </button>
        </div>
      )}

      {showForm && phase === 'idle' && (
        <div className="flex flex-col gap-2 max-w-md">
          <input
            type="text" placeholder="utest1... or ztestsapling1..." spellCheck={false}
            value={address} onChange={(e) => { setAddress(e.target.value); setMsg(null); }}
            onKeyDown={(e) => e.key === 'Enter' && address.trim() && void start()}
            className={`${input} font-mono`}
          />
          <div className="flex gap-2">
            <button onClick={() => void start()} disabled={busy || !address.trim()}
              className="btn-window px-4 py-2 text-[var(--accent-gold)] disabled:opacity-50 w-fit">
              {busy ? '…' : 'Link this address'}
            </button>
            {editing && (
              <button onClick={() => { setEditing(false); setAddress(''); setMsg(null); }}
                className="btn-window px-4 py-2 text-[var(--text-muted)] w-fit">Cancel</button>
            )}
          </div>
        </div>
      )}

      {challenge && phase === 'paying' && (
        <div className="flex flex-col gap-3 max-w-md">
          <div className="text-[var(--text-primary)] text-xs leading-relaxed">
            Send <b className="text-[var(--accent-gold)]">{challenge.valueZEC} TAZ</b> with the memo below, from any
            testnet wallet. We&rsquo;ll reply with a code as a memo to <b>the address you&rsquo;re linking</b> - that
            reply is the proof.
          </div>
          <div className="self-start bg-white p-2"><ZecQr value={challenge.zip321} size={156} /></div>
          {([['to', challenge.toAddress], ['memo', challenge.memoText]] as const).map(([label, val]) => (
            <div key={label} className="flex items-center gap-2">
              <span className="text-[var(--text-muted)] text-xs w-10">{label}</span>
              <code className="flex-1 text-xs break-all text-[var(--text-primary)]">{val}</code>
              <button onClick={() => void copy(label, val)} className="btn-window px-2 py-1 text-xs text-[var(--accent-gold)]">
                {copied === label ? '✓' : 'copy'}
              </button>
            </div>
          ))}
          <div className="text-[var(--text-muted)] text-xs">Waiting for the payment… checking every {POLL_MS / 1000}s.</div>
        </div>
      )}

      {challenge && phase === 'code' && (
        <div className="flex flex-col gap-2 max-w-sm">
          <div className="text-[var(--text-primary)] text-xs leading-relaxed">
            Check the wallet for <b>the address you&rsquo;re linking</b> for a memo with a 6-digit code.
          </div>
          <input
            type="text" inputMode="numeric" placeholder="6-digit code" maxLength={6}
            value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setMsg(null); }}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void verify()}
            className={`${input} font-mono tracking-widest`}
          />
          <button onClick={() => void verify()} disabled={busy || code.length !== 6}
            className="btn-window px-4 py-2 text-[var(--accent-gold)] disabled:opacity-50 w-fit">
            {busy ? '…' : 'Verify and link'}
          </button>
        </div>
      )}

      {phase === 'expired' && (
        <div className="flex items-center gap-3 text-xs">
          <span className="text-[var(--accent-orange)]">That verification expired before the payment arrived.</span>
          <button onClick={() => { setChallenge(null); setPhase('idle'); setMsg(null); }}
            className="btn-window px-3 py-1.5 text-[var(--accent-gold)]">Start again</button>
        </div>
      )}

      {msg && (
        <div className={`text-xs mt-2 ${msg.ok ? 'text-[var(--accent-green)]' : 'text-[var(--accent-orange)]'}`}>{msg.text}</div>
      )}
    </div>
  );
}
