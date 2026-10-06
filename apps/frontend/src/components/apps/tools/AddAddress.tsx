'use client';

import { useEffect, useRef, useState } from 'react';
import { ZecQr } from '@/components/ui/ZecQr';
import { copyText } from '@/utils/clipboard';

/**
 * Add another address to this account.
 *
 * WHY ANYONE NEEDS THIS
 * A wallet hands out a new unified address every time it is asked, so one key
 * makes many valid strings - and only the exact string used at verification
 * signs you in or resets a password. Someone who verified with one receiver and
 * later pasted a fresh address from the same wallet was a stranger to us.
 * Proving a second address here makes it yours too, so either one works.
 *
 * The proof is the one login already uses: send a small amount with a memo, we
 * reply with a code as a memo to the address being added, type the code back.
 * That shows you can read that address's memos, which is what controlling it
 * means - so transparent addresses cannot be added, because they cannot receive
 * the reply.
 *
 * It does NOT move anything. The address this account was created from stays
 * its primary, and on testnet the per-address cap and price still follow the
 * proven address for that network.
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

export function AddAddress({ token, primary }: { token: string; primary: string }) {
  const [open, setOpen] = useState(false);
  const [added, setAdded] = useState<string[]>([]);
  const [address, setAddress] = useState('');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const polling = useRef(false);

  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  // Watch for the payment, then for the code to have been sent.
  useEffect(() => {
    if (!challenge || phase !== 'paying') return;
    let live = true;
    const tick = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const r = await fetch(`/api/auth/link-address/${challenge.nonce}`, { headers: auth, cache: 'no-store' });
        const j = await r.json();
        if (!live) return;
        if (j.status === 'linked' && j.address) { finish(j.address); return; }
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
    setAdded((a) => (a.includes(addr) ? a : [...a, addr]));
    setChallenge(null); setPhase('idle'); setAddress(''); setCode('');
    setMsg({ text: 'Added ✓ - this address now signs you in as well.', ok: true });
  };

  const start = async () => {
    setMsg(null); setBusy(true);
    try {
      const r = await fetch('/api/auth/link-address', {
        method: 'POST', headers: auth, body: JSON.stringify({ address: address.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error ?? `HTTP ${r.status}`, ok: false }); return; }
      if (j.linked) { finish(j.address ?? address.trim()); return; }
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
      const r = await fetch('/api/auth/link-address/verify-code', {
        method: 'POST', headers: auth, body: JSON.stringify({ nonce: challenge.nonce, code: code.trim() }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg({ text: j.error ?? `HTTP ${r.status}`, ok: false }); return; }
      finish(j.address ?? '');
    } catch {
      setMsg({ text: 'Backend unreachable', ok: false });
    } finally {
      setBusy(false);
    }
  };

  const copy = async (label: string, text: string) => {
    if (await copyText(text)) { setCopied(label); setTimeout(() => setCopied(null), 1600); }
  };

  const input = 'bg-[var(--bg-window)] border border-[var(--border-window)] text-[var(--text-primary)] px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent-gold)]';

  return (
    <div className="border border-[var(--border-window)] p-3 bg-[var(--bg-inset)]">
      <div className="text-[var(--text-muted)] text-xs mb-1">YOUR ADDRESSES</div>
      <div className="text-[var(--text-muted)] text-xs mb-3 leading-relaxed">
        Your wallet hands out a new address every time you ask it for one, and only the exact address
        you verified with signs you in. Add another here and either one works - useful before you lose
        track of which was which.
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-2">
        <span className="text-[var(--accent-gold)] text-xs break-all">{primary}</span>
        <span className="text-[var(--text-muted)] text-xs">primary</span>
      </div>
      {added.map((a) => (
        <div key={a} className="flex items-center gap-2 flex-wrap mb-2">
          <span className="text-[var(--accent-green)] text-xs break-all">{a}</span>
          <span className="text-[var(--text-muted)] text-xs">added</span>
        </div>
      ))}

      {!open && phase === 'idle' && (
        <button onClick={() => { setOpen(true); setMsg(null); }} className="btn-window px-3 py-1.5 text-xs text-[var(--accent-gold)]">
          + Add another address
        </button>
      )}

      {open && phase === 'idle' && (
        <div className="flex flex-col gap-2 max-w-md mt-1">
          <input
            type="text" placeholder="u1… or zs1…" spellCheck={false}
            value={address} onChange={(e) => { setAddress(e.target.value); setMsg(null); }}
            onKeyDown={(e) => e.key === 'Enter' && address.trim() && void start()}
            className={`${input} font-mono`}
          />
          <div className="flex gap-2">
            <button onClick={() => void start()} disabled={busy || !address.trim()}
              className="btn-window px-4 py-2 text-[var(--accent-gold)] disabled:opacity-50 w-fit">
              {busy ? '…' : 'Add this address'}
            </button>
            <button onClick={() => { setOpen(false); setAddress(''); setMsg(null); }}
              className="btn-window px-4 py-2 text-[var(--text-muted)] w-fit">Cancel</button>
          </div>
        </div>
      )}

      {challenge && phase === 'paying' && (
        <div className="flex flex-col gap-3 max-w-md mt-1">
          <div className="text-[var(--text-primary)] text-xs leading-relaxed">
            Send <b className="text-[var(--accent-gold)]">{challenge.valueZEC} ZEC</b> with the memo below, from any
            wallet. We&rsquo;ll reply with a code as a memo to <b>the address you&rsquo;re adding</b> - that reply
            is the proof.
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
        <div className="flex flex-col gap-2 max-w-sm mt-1">
          <div className="text-[var(--text-primary)] text-xs leading-relaxed">
            Check the wallet for <b>the address you&rsquo;re adding</b> for a memo with a 6-digit code.
          </div>
          <input
            type="text" inputMode="numeric" placeholder="6-digit code" maxLength={6}
            value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setMsg(null); }}
            onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && void verify()}
            className={`${input} font-mono tracking-widest`}
          />
          <button onClick={() => void verify()} disabled={busy || code.length !== 6}
            className="btn-window px-4 py-2 text-[var(--accent-gold)] disabled:opacity-50 w-fit">
            {busy ? '…' : 'Verify and add'}
          </button>
        </div>
      )}

      {phase === 'expired' && (
        <div className="flex items-center gap-3 text-xs mt-1">
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
