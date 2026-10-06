'use client';

import { useState } from 'react';
import { ZecQr } from '@/components/ui/ZecQr';
import { paymentUri, canMemo, memoBytes, MEMO_MAX_BYTES, normAmount } from '@/lib/zip321';
import { detectAddress } from '@/lib/zaddr';
import { copyText } from '@/utils/clipboard';
import { FS, Tag, Card, Tags, CardTitle, Body, inputStyle } from '@/components/ui/InfoTag';

/**
 * One Pay Me page: amount, an optional private note, and a ZIP 321 payment
 * request as a QR and a wallet link. Request-only: nothing here watches for
 * the payment, and ZEC-OS never touches the money. "Already paid?" checks a
 * txid's confirmations; for shielded payments that is all anyone but the two
 * of you can see.
 */

export interface PayPageData {
  address: string;
  title?: string | null;
  bio?: string | null;
  amounts?: string[] | null;
  memoHint?: string | null;
}

export function PayCard({ page, name, preview = false }: { page: PayPageData; name: string; preview?: boolean }) {
  const presets = (page.amounts ?? []).filter((a) => normAmount(a));
  const [amount, setAmount] = useState(presets[0] ?? '');
  const [memo, setMemo] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [txid, setTxid] = useState('');
  const [tx, setTx] = useState<[string, 'ok' | 'warn' | 'bad'] | null>(null);
  const info = detectAddress(page.address);
  const memoOk = canMemo(page.address);
  const tooLong = memoBytes(memo) > MEMO_MAX_BYTES;
  const uri = paymentUri({ address: page.address, amount: normAmount(amount) ?? undefined, memo: memoOk && memo && !tooLong ? memo : undefined });
  const copy = (what: string, v: string) => { copyText(v); setCopied(what); setTimeout(() => setCopied(null), 1300); };

  const check = async () => {
    const t = txid.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(t)) { setTx(['That is not a transaction id (64 hex characters).', 'bad']); return; }
    setTx(['Looking it up...', 'warn']);
    try {
      const r = await fetch(`/api/tx/${t}`);
      if (!r.ok) { setTx(['Not found yet. If you just sent it, give it a minute.', 'warn']); return; }
      const d = await r.json() as { confirmations?: number };
      const c = d.confirmations ?? 0;
      setTx([c > 0 ? `On chain with ${c} confirmation${c === 1 ? '' : 's'}.` : 'Seen, waiting for its first block.', c > 0 ? 'ok' : 'warn']);
    } catch { setTx(['Could not reach the chain right now.', 'bad']); }
  };

  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Card accent="gold">
        <CardTitle right={<Tag value={info.shielded ? 'shielded' : 'transparent'} tone={info.shielded ? 'ok' : 'warn'} />}>{page.title || `Pay ${name}`}</CardTitle>
        {page.bio && <Body>{page.bio}</Body>}
        <div className="flex flex-wrap items-center gap-2">
          {presets.map((a) => (
            <button key={a} onClick={() => setAmount(a)} className="btn-window px-3 py-1"
              style={{ fontSize: FS.body, color: amount === a ? 'var(--accent-gold)' : undefined, borderColor: amount === a ? 'var(--accent-gold)' : undefined }}>{a} ZEC</button>
          ))}
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="Amount in ZEC (optional)" inputMode="decimal"
            className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input, maxWidth: 210 }} />
        </div>
        {memoOk ? (
          <label className="flex flex-col gap-1" style={{ fontSize: FS.body }}>
            <span className="text-[var(--text-secondary)]">{page.memoHint || 'Add a note (private: only the two of you can read it)'}</span>
            <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />
            {tooLong && <span style={{ color: 'var(--accent-orange)' }}>Too long: a memo holds {MEMO_MAX_BYTES} bytes.</span>}
          </label>
        ) : <Body>This is a transparent address: notes cannot ride along, and the payment is public on the chain.</Body>}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center" style={{ gap: 18 }}>
          <ZecQr value={uri} size={176} />
          <div className="flex flex-col gap-2 flex-1 min-w-[200px]">
            <Body>Scan with any Zcash wallet, or open it on this device. Check the amount and address in your wallet before you send.</Body>
            <Tags>
              <a href={preview ? undefined : uri} className="btn-window px-3 py-1 text-[var(--accent-gold)]" style={{ fontSize: FS.body }}>Open in wallet</a>
              <button className="btn-window px-3 py-1" style={{ fontSize: FS.body }} onClick={() => copy('uri', uri)}>{copied === 'uri' ? '✓ Copied' : 'Copy request'}</button>
              <button className="btn-window px-3 py-1" style={{ fontSize: FS.body }} onClick={() => copy('addr', page.address)}>{copied === 'addr' ? '✓ Copied' : 'Copy address'}</button>
            </Tags>
            <code className="break-all text-[var(--text-muted)]" style={{ fontSize: FS.small }}>{page.address}</code>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Already paid?</CardTitle>
        <Body>Paste the transaction id from your wallet to see that it reached the chain. Amounts and notes in shielded payments stay private, even from this check.</Body>
        <div className="flex flex-wrap items-center gap-2">
          <input value={txid} onChange={(e) => setTxid(e.target.value)} placeholder="Transaction id" spellCheck={false} disabled={preview}
            className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input, maxWidth: 420 }} />
          <button className="btn-window px-3 py-1" style={{ fontSize: FS.body }} disabled={preview} onClick={check}>Check</button>
        </div>
        {tx && <Tag value={tx[0]} tone={tx[1]} />}
      </Card>
      <div className="text-[var(--text-muted)]" style={{ fontSize: FS.small }}>A ZEC-OS Pay Me page. ZEC-OS never holds the money: you pay {name} directly.</div>
    </div>
  );
}
