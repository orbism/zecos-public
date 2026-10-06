'use client';

import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { PayCard, type PayPageData } from '@/components/pay/PayCard';
import { detectAddress } from '@/lib/zaddr';
import { normAmount } from '@/lib/zip321';
import { copyText } from '@/utils/clipboard';
import { FS, Tag, Card, Tags, CardTitle, Body, Picker, inputStyle, type Tone } from '@/components/ui/InfoTag';

/**
 * Pay Me: a payment page at zec-os.com/pay/<your name>. Verified accounts set
 * where to be paid and what to show; anyone can pay through it. Request-only:
 * ZEC-OS builds the payment request and never sees or holds the money.
 */

type Tab = 'mine' | 'find';
interface Mine extends PayPageData { enabled: boolean }
const BLANK: Mine = { address: '', title: '', bio: '', amounts: [], memoHint: '', enabled: true };

function MyPage() {
  const token = useAuthStore((s) => s.sessionToken);
  const verified = useAuthStore((s) => s.isVerified);
  const name = useAuthStore((s) => s.displayName);
  const [page, setPage] = useState<Mine>(BLANK);
  const [amounts, setAmounts] = useState('');
  const [handle, setHandle] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [msg, setMsg] = useState<[string, Tone] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token || !verified) return;
    void fetch('/api/pay/me', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).then((j) => {
      setHandle(j.handle ?? null);
      if (j.page) { setPage({ ...BLANK, ...j.page }); setAmounts((j.page.amounts ?? []).join(', ')); }
      setLoaded(true);
    }).catch(() => setLoaded(true));
  }, [token, verified]);

  if (!verified || !token) {
    return <Card><CardTitle>Your Pay Me page</CardTitle><Body>Pay Me pages are for verified accounts: your page lives at zec-os.com/pay/your-name. Verify your address from the Account app, then come back.</Body></Card>;
  }
  if (!loaded) return <Body>Loading your page...</Body>;

  const info = page.address ? detectAddress(page.address) : null;
  const addrOk = !!info && info.network === 'mainnet' && ['transparent-p2pkh', 'transparent-p2sh', 'sapling', 'unified'].includes(info.kind) && info.checksum !== false;
  const presetList = amounts.split(/[,\s]+/).map((a) => normAmount(a)).filter((a): a is string => !!a).slice(0, 6);
  const link = handle ? `${typeof window !== 'undefined' ? window.location.origin : 'https://zec-os.com'}/pay/${handle}` : null;

  const save = async () => {
    setMsg(null);
    try {
      const r = await fetch('/api/pay/me', {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...page, amounts: presetList }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg([j.error ?? `Could not save (${r.status})`, 'bad']); return; }
      setHandle(j.handle ?? handle);
      setMsg([page.enabled ? 'Saved. Your page is live.' : 'Saved. Your page is switched off.', 'ok']);
    } catch { setMsg(['Backend unreachable', 'bad']); }
  };
  const field = (k: keyof Mine, label: string, ph: string, multi = false) => (
    <label className="flex flex-col gap-1" style={{ fontSize: FS.body }}>
      <span className="text-[var(--text-secondary)]">{label}</span>
      {multi
        ? <textarea value={String(page[k] ?? '')} onChange={(e) => setPage({ ...page, [k]: e.target.value })} placeholder={ph} rows={2} className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />
        : <input value={String(page[k] ?? '')} onChange={(e) => setPage({ ...page, [k]: e.target.value })} placeholder={ph} spellCheck={k !== 'address'} className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />}
    </label>
  );

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Card accent="gold">
        <CardTitle right={link && <Tag value={page.enabled ? 'live' : 'off'} tone={page.enabled ? 'ok' : 'muted'} />}>Your Pay Me page</CardTitle>
        {link ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-[var(--text-green)] break-all" style={{ fontSize: FS.body }}>{link}</code>
            <button className="btn-window px-3 py-1" style={{ fontSize: FS.body }} onClick={() => { copyText(link); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? '✓ Copied' : 'Copy link'}</button>
            <a className="btn-window px-3 py-1" style={{ fontSize: FS.body }} href={link} target="_blank" rel="noopener noreferrer">Open ↗</a>
          </div>
        ) : <Body>Pick a display name in the Account app first: it becomes your page address.</Body>}
        {field('address', 'Where to be paid', 'u1..., zs1... or t1...')}
        {info && (
          <Tags>
            <Tag label="Address" value={info.label} tone={addrOk ? (info.shielded ? 'ok' : 'warn') : 'bad'} />
            {info.checksum === false && <Tag value="checksum fails: check for a typo" tone="bad" />}
            {addrOk && !info.shielded && <Tag value="transparent: payments to it are public, and no private notes" tone="warn" />}
          </Tags>
        )}
        <Body>Use an address you control in a wallet you check. A fresh shielded address just for this page keeps it separate from the rest of your funds.</Body>
        {field('title', 'Title', `Pay ${name ?? 'me'}`)}
        {field('bio', 'A line about you or what this is for', 'Freelance design, tips welcome', true)}
        <label className="flex flex-col gap-1" style={{ fontSize: FS.body }}>
          <span className="text-[var(--text-secondary)]">Quick amounts in ZEC (up to 6, comma separated)</span>
          <input value={amounts} onChange={(e) => setAmounts(e.target.value)} placeholder="0.05, 0.1, 0.5" className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />
        </label>
        {field('memoHint', 'Prompt for the payer\'s note (shielded addresses only)', 'Say what it is for')}
        <div className="flex flex-wrap items-center gap-3">
          <Picker label="Page" value={page.enabled ? 'on' : 'off'} onChange={(v) => setPage({ ...page, enabled: v === 'on' })} options={[['on', 'Live'], ['off', 'Switched off']]} />
          <button className="btn-window px-4 py-1.5 text-[var(--accent-gold)] disabled:opacity-50" style={{ fontSize: FS.body }} disabled={!addrOk} onClick={save}>Save</button>
          {msg && <Tag value={msg[0]} tone={msg[1]} />}
        </div>
      </Card>
      {addrOk && (
        <>
          <div className="text-[var(--text-muted)]" style={{ fontSize: FS.small }}>Preview: what payers see</div>
          <PayCard page={{ ...page, amounts: presetList }} name={name ?? 'me'} preview />
        </>
      )}
    </div>
  );
}

function Find() {
  const [h, setH] = useState('');
  const [found, setFound] = useState<{ page: PayPageData; name: string } | 'missing' | null>(null);
  const look = async () => {
    const k = h.trim().replace(/^.*\/pay\//, '');
    if (!k) return;
    setFound(null);
    try {
      const r = await fetch(`/api/pay/${encodeURIComponent(k)}`);
      const j = r.ok ? await r.json() : null;
      setFound(j?.page ? { page: j.page, name: j.name ?? k } : 'missing');
    } catch { setFound('missing'); }
  };
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Card>
        <CardTitle>Pay someone</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <input value={h} onChange={(e) => setH(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void look()} placeholder="Their ZEC-OS name or Pay Me link"
            className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input, maxWidth: 360 }} />
          <button className="btn-window px-3 py-1" style={{ fontSize: FS.body }} onClick={look}>Find</button>
        </div>
      </Card>
      {found === 'missing' && <Body>No Pay Me page under that name.</Body>}
      {found && found !== 'missing' && <PayCard page={found.page} name={found.name} />}
    </div>
  );
}

export default function PayMe() {
  const [tab, setTab] = useState<Tab>('mine');
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-2 px-4 pt-3 shrink-0 flex-wrap">
        {([['mine', 'My page'], ['find', 'Pay someone']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className="btn-window px-3 py-1.5"
            style={{ fontSize: FS.body, color: tab === id ? 'var(--accent-gold)' : 'var(--text-secondary)', borderColor: tab === id ? 'var(--accent-gold)' : undefined }}>{label}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 16 }}>
        {tab === 'mine' ? <MyPage /> : <Find />}
      </div>
    </div>
  );
}
