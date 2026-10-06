'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useUiModeStore } from '@/store/uiModeStore';
import { useThemeStore } from '@/store/themeStore';

/**
 * The Explorer's minimal26 views: what a block, a transaction or an address
 * IS, in one plain sentence first; then the few numbers that matter; then
 * every fact as a row with a one-line hint, alternating graphite and navy;
 * then the technical detail, folded away. A "?" beside anything opens a
 * short explanation and closes on any click.
 *
 * Built for the least technical person who will ever open the Explorer:
 * plain words ("private", "public", "new coins") over protocol names, hashes
 * in groups of four with a Copy that takes the whole thing, and nothing to
 * hit smaller than 40px.
 */

// ── Shapes (mirrors of the Explorer's results) ────────────────────────────
export interface M26Block {
  hash: string; height: number; confirmations: number; time: number; difficulty: number; nonce: string;
  size: number; txCount: number; transactions: string[]; merkleroot: string; previousblockhash?: string; nextblockhash?: string;
}
export interface M26Tx {
  txid: string; size: number; version: number; locktime: number; expiryheight: number; blockheight?: number; confirmations?: number; time?: number;
  vinCount: number; voutCount: number; transparentValue: number; hasSprout: boolean; hasSapling: boolean; hasOrchard: boolean;
  saplingSpends: number; saplingOutputs: number; orchardActions: number; isFullyShielded: boolean; isPartiallyShielded: boolean; isCoinbase: boolean;
}
export interface M26TAddress { address: string; balance: number; received: number; txCount: number; transactions: Array<{ txid: string; height: number; timestamp: number; delta: number }> }
export interface M26ZAddress { address: string; type: 'sapling' | 'orchard' | 'unified'; valid: boolean; message: string }
type Search = (q: string, t: 'auto' | 't-address' | 'z-address' | 'transaction' | 'block') => void;

/*
 * The API hands back node-shaped JSON, sometimes wrapped (`result`, `data`,
 * `block`, `transaction`), with zcashd's own field names. These read it the
 * same forgiving way the classic views do, so both modes agree on every fact.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any;
const unwrap = (r: Raw, key: string): Raw => (r?.result && typeof r.result === 'object' ? r.result
  : r?.data && typeof r.data === 'object' && !Array.isArray(r.data) ? r.data
  : r?.[key] && typeof r[key] === 'object' ? r[key] : r);
export function normBlock(raw: unknown): M26Block {
  const r = unwrap(raw, 'block');
  const transactions: string[] = (r?.transactions || r?.tx || []).map((t: Raw) => (typeof t === 'string' ? t : t?.txid ?? ''));
  return {
    hash: r?.hash || r?.blockhash || '', height: r?.height ?? r?.blockheight ?? 0, confirmations: r?.confirmations ?? 0,
    time: r?.time ?? r?.blocktime ?? 0, difficulty: r?.difficulty ?? 0, nonce: String(r?.nonce ?? ''), size: r?.size ?? 0,
    txCount: r?.txCount ?? r?.nTx ?? transactions.length, transactions, merkleroot: r?.merkleroot || '',
    previousblockhash: r?.previousblockhash || undefined, nextblockhash: r?.nextblockhash || undefined,
  };
}
export function normTx(raw: unknown): M26Tx {
  const r = unwrap(raw, 'transaction');
  const vin: Raw[] = r?.vin || [], vout: Raw[] = r?.vout || [];
  const saplingSpends = (r?.vShieldedSpend || []).length, saplingOutputs = (r?.vShieldedOutput || []).length;
  const orchardActions = r?.orchard?.actions?.length ?? 0, sprout = (r?.vjoinsplit || []).length;
  const hasSapling = saplingSpends + saplingOutputs > 0, hasOrchard = orchardActions > 0, hasSprout = sprout > 0;
  const shielded = hasSapling || hasOrchard || hasSprout;
  const isCoinbase = vin.length === 1 && vin[0]?.coinbase !== undefined;
  const transparentValue = vout.reduce((a: number, o: Raw) => a + (o?.valueSat ?? Math.round((o?.value ?? 0) * 1e8)), 0);
  return {
    txid: r?.txid || r?.hash || '', size: r?.size ?? r?.vsize ?? 0, version: r?.version ?? 0, locktime: r?.locktime ?? 0,
    expiryheight: r?.expiryheight ?? 0, blockheight: r?.blockheight ?? r?.height ?? undefined, confirmations: r?.confirmations ?? undefined,
    time: r?.time ?? r?.blocktime ?? undefined, vinCount: vin.length, voutCount: vout.length, transparentValue,
    hasSprout, hasSapling, hasOrchard, saplingSpends, saplingOutputs, orchardActions,
    isFullyShielded: shielded && !isCoinbase && vin.length === 0 && vout.length === 0,
    isPartiallyShielded: shielded && !isCoinbase && (vin.length > 0 || vout.length > 0), isCoinbase,
  };
}
export function normTAddress(raw: unknown): M26TAddress {
  const r = unwrap(raw, 'address');
  const list: Raw[] = r?.transactions || r?.txids || r?.history || r?.txHistory || r?.tx_list || [];
  return {
    address: r?.address || '', balance: r?.balance ?? 0, received: r?.received ?? 0, txCount: r?.txCount ?? list.length,
    transactions: list.map((t: Raw) => (typeof t === 'string' ? { txid: t, height: 0, timestamp: 0, delta: NaN } : { txid: t?.txid ?? '', height: t?.height ?? 0, timestamp: t?.timestamp ?? t?.time ?? 0, delta: t?.delta ?? NaN })),
  };
}

// ── Words ─────────────────────────────────────────────────────────────────
const zec = (zat: number) => `${(zat / 1e8).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} ZEC`;
const n = (v: number) => v.toLocaleString('en-US');
const bytes = (b: number) => (b < 1024 ? `${b} bytes` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(2)} MB`);
const when = (unix: number) => new Date(unix * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
function ago(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - unix));
  const u: [number, string][] = [[31536000, 'year'], [2592000, 'month'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [k, w] of u) if (s >= k) { const v = Math.floor(s / k); return `${v} ${w}${v > 1 ? 's' : ''} ago`; }
  return 'just now';
}
/** A hash in groups of four, optionally with the middle elided. */
function groups(h: string, short = false): string {
  const g = h.match(/.{1,4}/g) ?? [h];
  return short && g.length > 6 ? `${g.slice(0, 2).join(' ')} … ${g.slice(-2).join(' ')}` : g.join(' ');
}
const settled = (c: number) => (c >= 10 ? 'final' : c >= 1 ? 'settling' : 'waiting');

/** The explanations behind every "?". Short, and in plain words. */
const HELP: Record<string, [string, string]> = {
  block: ['What is a block?', 'A block is one page of Zcash’s public record. A new page is added about every 75 seconds, and each one lists the transactions that happened since the last.'],
  confirmations: ['What are confirmations?', 'How many blocks have been added on top of this one. Each one makes it harder to undo. Most wallets treat 10 as final.'],
  hash: ['What is a hash?', 'A unique fingerprint, made from the contents. Change one character of the contents and the fingerprint changes completely, which is how anyone can check nothing was altered.'],
  size: ['Why does size matter?', 'How much data this takes up on every computer that keeps a copy of the chain. Private transactions are bigger, because they carry a mathematical proof.'],
  difficulty: ['What is difficulty?', 'How hard it was to add this block. Miners compete to solve a puzzle; the network makes the puzzle harder or easier to keep blocks about 75 seconds apart.'],
  merkle: ['What is the merkle root?', 'One fingerprint that sums up every transaction in the block. If any transaction changed, this would too.'],
  nonce: ['What is the nonce?', 'The number the miner kept changing until the block’s fingerprint met the difficulty. It is how a block is “mined”.'],
  neighbours: ['Previous and next', 'Every block points to the one before it. That chain of pointers is why it is called a blockchain.'],
  txid: ['What is a transaction ID?', 'The fingerprint of one transaction. Share it to show someone a payment happened, without sharing anything private.'],
  private: ['What does private mean?', 'Shielded. The sender, the receiver and the amount are encrypted. The chain proves the payment is valid without revealing any of it.'],
  public: ['What does public mean?', 'Transparent. Like Bitcoin: the addresses and amounts are visible to anyone. Zcash lets you move money from public to private, which is called shielding.'],
  coinbase: ['What are new coins?', 'The first transaction in every block pays the miner (and the dev fund) in brand-new ZEC. That is the only way new ZEC comes into existence.'],
  pools: ['What are the shielded parts?', 'Zcash has had three private systems: Sprout (the first), Sapling and Orchard (the newest). These counts show how this transaction used them; the contents stay encrypted.'],
  inout: ['Inputs and outputs', 'The public parts of a transaction: where visible money came from (inputs) and where it went (outputs). Private parts are not counted here.'],
  address: ['What is an address?', 'Where ZEC can be sent, like an account number. Public addresses (t1…) show their history to everyone; private ones (u1…, zs1…) show nothing.'],
  balance: ['How is the balance known?', 'For a public address, anyone can add up what came in and what went out. That is exactly why private addresses exist.'],
  zaddr: ['Why can’t I see more?', 'This is a private address. Its balance and history are encrypted on the chain, so no explorer can show them. That is working as intended.'],
  expiry: ['What is expiry?', 'A transaction that has not been included by this block height is dropped, so a stuck payment can never surprise you later.'],
};

// ── Pieces ────────────────────────────────────────────────────────────────
/** A "?" that opens a short explanation; any click or Esc closes it. */
function Help({ k }: { k: keyof typeof HELP }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [open]);
  const [title, body] = HELP[k]!;
  return (
    <>
      <button type="button" className="m26-help" aria-label={title} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>?</button>
      {open && typeof document !== 'undefined' && createPortal(
        <div className="m26-modal-back" onClick={() => setOpen(false)} role="presentation">
          <div className="m26-modal" role="dialog" aria-label={title} onClick={() => setOpen(false)}>
            <div className="m26-modal-title">{title}</div>
            <p>{body}</p>
            <div className="m26-modal-hint">Click anywhere to close</div>
          </div>
        </div>, document.body)}
    </>
  );
}

function Copy({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="m26-btn" onClick={() => { navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); }}>
      {done ? '✓ Copied' : `⧉ ${label}`}
    </button>
  );
}

function Hero({ eyebrow, children, tone = 'navy' }: { eyebrow: React.ReactNode; children: React.ReactNode; tone?: 'navy' | 'grey' }) {
  return <section className={`m26-hero m26-${tone}`}><div className="m26-eyebrow">{eyebrow}</div><p>{children}</p></section>;
}

function Tiles({ items }: { items: { v: React.ReactNode; l: string; help?: keyof typeof HELP }[] }) {
  return (
    <div className="m26-tiles">
      {items.map((it) => (
        <div key={it.l} className="m26-tile">
          <div className="m26-tile-v">{it.v}</div>
          <div className="m26-tile-l">{it.l}{it.help && <Help k={it.help} />}</div>
        </div>
      ))}
    </div>
  );
}

/** One fact: a label with its one-line hint, the value, and room for an action. */
function Row({ k, hint, help, children, action }: { k: string; hint?: string; help?: keyof typeof HELP; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="m26-row">
      <div className="m26-k">
        <div className="m26-k-line">{k}{help && <Help k={help} />}</div>
        {hint && <small>{hint}</small>}
      </div>
      <div className="m26-v">{children}</div>
      <div className="m26-a">{action}</div>
    </div>
  );
}

function Section({ title, aside, children, fold = false }: { title: string; aside?: React.ReactNode; children: React.ReactNode; fold?: boolean }) {
  const [open, setOpen] = useState(!fold);
  return (
    <section className="m26-sec">
      <h3>
        {fold
          ? <button type="button" className="m26-fold" onClick={() => setOpen(!open)} aria-expanded={open}>{title}<span>{open ? 'hide ▴' : 'show ▾'}</span></button>
          : <>{title}{aside && <span>{aside}</span>}</>}
      </h3>
      {open && <div className="m26-rows">{children}</div>}
    </section>
  );
}

const Pill = ({ kind, children }: { kind: 'private' | 'public' | 'new' | 'mixed'; children: React.ReactNode }) => <span className={`m26-pill m26-pill-${kind}`}>{children}</span>;

// ── Block ─────────────────────────────────────────────────────────────────
export function M26BlockView({ data: raw, onSearch, onBlockMap, onChainPulse }: { data: unknown; onSearch: Search;
  /** The classic view's visualisations, still a click away. */
  onBlockMap?: (height: number, hash: string, txs: string[], time: number, size: number) => void;
  onChainPulse?: (height: number, hash: string, txs: string[], time: number) => void }) {
  const data = normBlock(raw);
  const [all, setAll] = useState(false);
  const txs = all ? data.transactions : data.transactions.slice(0, 8);
  return (
    <div className="m26">
      <Hero eyebrow={<>Block {n(data.height)} <Help k="block" /></>}>
        Added <em>{ago(data.time)}</em> with {n(data.txCount)} transaction{data.txCount === 1 ? '' : 's'}.
      </Hero>
      <Tiles items={[
        { v: n(data.confirmations), l: `confirmations · ${settled(data.confirmations)}`, help: 'confirmations' },
        { v: n(data.txCount), l: 'transactions' },
        { v: bytes(data.size), l: 'size of this block', help: 'size' },
      ]} />
      <Section title="About this block">
        <Row k="Added" hint="When this block joined the chain">{when(data.time)}</Row>
        <Row k="Block hash" hint="This block’s unique fingerprint" help="hash" action={<Copy value={data.hash} label="Copy full hash" />}>
          <span className="m26-mono">{groups(data.hash, true)}</span>
        </Row>
        <Row k="Neighbours" hint="The blocks before and after" help="neighbours">
          <span className="m26-nav">
            {data.height > 0 && <button type="button" className="m26-link" onClick={() => onSearch(String(data.height - 1), 'block')}>← {n(data.height - 1)}</button>}
            {data.nextblockhash && <button type="button" className="m26-link" onClick={() => onSearch(String(data.height + 1), 'block')}>{n(data.height + 1)} →</button>}
          </span>
        </Row>
      </Section>
      <Section title="Transactions in this block" aside={`${n(data.txCount)} total`}>
        {txs.map((t, i) => (
          <Row key={t} k={i === 0 ? 'First (new coins)' : `#${i + 1}`} help={i === 0 ? 'coinbase' : undefined}
            action={<button type="button" className="m26-btn" onClick={() => onSearch(t, 'transaction')}>Open</button>}>
            <span className="m26-mono">{groups(t, true)}</span>
          </Row>
        ))}
        {!all && data.transactions.length > 8 && (
          <button type="button" className="m26-more" onClick={() => setAll(true)}>Show all {n(data.transactions.length)} transactions</button>
        )}
      </Section>
      {(onBlockMap || onChainPulse) && (
        <Section title="See it drawn">
          <Row k="Pictures of this block" hint="The same block, as a map or a pulse">
            <span className="m26-nav">
              {onBlockMap && <button type="button" className="m26-btn" onClick={() => onBlockMap(data.height, data.hash, data.transactions, data.time, data.size)}>Block Map</button>}
              {onChainPulse && <button type="button" className="m26-btn" onClick={() => onChainPulse(data.height, data.hash, data.transactions, data.time)}>Chain Pulse</button>}
            </span>
          </Row>
        </Section>
      )}
      <Section title="Technical details" fold>
        <Row k="Difficulty" help="difficulty">{n(Math.round(data.difficulty))}</Row>
        <Row k="Merkle root" help="merkle" action={<Copy value={data.merkleroot} />}><span className="m26-mono">{groups(data.merkleroot, true)}</span></Row>
        <Row k="Nonce" help="nonce"><span className="m26-mono">{groups(data.nonce, true)}</span></Row>
        <Row k="Full hash" action={<Copy value={data.hash} />}><span className="m26-mono m26-wrap">{groups(data.hash)}</span></Row>
      </Section>
    </div>
  );
}

// ── Transaction ───────────────────────────────────────────────────────────
function kindOf(d: M26Tx): { pill: React.ReactNode; sentence: React.ReactNode; help: keyof typeof HELP } {
  if (d.isCoinbase) return { pill: <Pill kind="new">New coins</Pill>, sentence: <>New coins, paid to the miner of block {d.blockheight ? n(d.blockheight) : '…'}.</>, help: 'coinbase' };
  if (d.isFullyShielded) return { pill: <Pill kind="private">Private</Pill>, sentence: <>A <em>private</em> payment. Who sent it, who got it and how much are all encrypted.</>, help: 'private' };
  if (d.isPartiallyShielded) return { pill: <Pill kind="mixed">Public ↔ private</Pill>, sentence: <>Money moving <em>between public and private</em>. The public side is visible; the private side is not.</>, help: 'private' };
  return { pill: <Pill kind="public">Public</Pill>, sentence: <>A <em>public</em> payment. Its addresses and amounts are visible to anyone.</>, help: 'public' };
}

export function M26TxView({ data: raw, onSearch }: { data: unknown; onSearch: Search }) {
  const data = normTx(raw);
  const k = kindOf(data);
  const parts = [data.hasSprout && 'Sprout', data.hasSapling && 'Sapling', data.hasOrchard && 'Orchard'].filter(Boolean).join(', ');
  return (
    <div className="m26">
      <Hero eyebrow={<>Transaction {k.pill}</>}>{k.sentence}</Hero>
      <Tiles items={[
        { v: data.confirmations !== undefined ? n(data.confirmations) : '…', l: data.confirmations !== undefined ? `confirmations · ${settled(data.confirmations)}` : 'waiting for a block', help: 'confirmations' },
        { v: data.transparentValue > 0 ? zec(data.transparentValue) : 'hidden', l: data.transparentValue > 0 ? 'moved in public' : 'amount is private', help: data.transparentValue > 0 ? 'public' : 'private' },
        { v: bytes(data.size), l: 'size', help: 'size' },
      ]} />
      <Section title="About this transaction">
        <Row k="Transaction ID" hint="Its unique fingerprint" help="txid" action={<Copy value={data.txid} label="Copy full ID" />}>
          <span className="m26-mono">{groups(data.txid, true)}</span>
        </Row>
        <Row k="Kind" hint="Private, public, or both" help={k.help}>{k.pill}</Row>
        {data.time && <Row k="When" hint="When its block was added">{when(data.time)} · {ago(data.time)}</Row>}
        {data.blockheight !== undefined && (
          <Row k="In block" hint="The page of the record it is on" help="block"
            action={<button type="button" className="m26-btn" onClick={() => onSearch(String(data.blockheight), 'block')}>Open block</button>}>
            {n(data.blockheight)}
          </Row>
        )}
        <Row k="Public inputs and outputs" hint="Visible money in, and out" help="inout">{data.vinCount} in · {data.voutCount} out</Row>
        {parts && <Row k="Private parts" hint="How it used Zcash’s private systems" help="pools">
          {[data.saplingSpends + data.saplingOutputs > 0 && `${data.saplingSpends + data.saplingOutputs} Sapling`, data.orchardActions > 0 && `${data.orchardActions} Orchard`, data.hasSprout && 'Sprout'].filter(Boolean).join(' · ')}
        </Row>}
      </Section>
      <Section title="Technical details" fold>
        <Row k="Version">{data.version}</Row>
        <Row k="Expires at block" help="expiry">{data.expiryheight ? n(data.expiryheight) : 'never'}</Row>
        <Row k="Lock time">{data.locktime}</Row>
        <Row k="Full ID" action={<Copy value={data.txid} />}><span className="m26-mono m26-wrap">{groups(data.txid)}</span></Row>
      </Section>
    </div>
  );
}

// ── Addresses ─────────────────────────────────────────────────────────────
export function M26TAddressView({ data: raw, onSearch }: { data: unknown; onSearch: Search }) {
  const data = normTAddress(raw);
  return (
    <div className="m26">
      <Hero eyebrow={<>Public address <Pill kind="public">Public</Pill> <Help k="address" /></>}>
        This address holds <em>{zec(data.balance)}</em> and has been used in {n(data.txCount)} transaction{data.txCount === 1 ? '' : 's'}.
      </Hero>
      <Tiles items={[
        { v: zec(data.balance), l: 'balance now', help: 'balance' },
        { v: zec(data.received), l: 'received, all time' },
        { v: n(data.txCount), l: 'transactions' },
      ]} />
      <Section title="About this address">
        <Row k="Address" hint="Share it to receive ZEC (publicly)" help="address" action={<Copy value={data.address} />}>
          <span className="m26-mono m26-wrap">{groups(data.address)}</span>
        </Row>
      </Section>
      <Section title="Recent activity" aside={`${n(data.transactions.length)} shown`}>
        {data.transactions.map((t) => (
          <Row key={t.txid + t.height} k={Number.isNaN(t.delta) ? 'Transaction' : t.delta >= 0 ? 'Received' : 'Sent'}
            hint={[t.timestamp ? when(t.timestamp) : '', t.height ? `block ${n(t.height)}` : ''].filter(Boolean).join(' · ') || undefined}
            action={<button type="button" className="m26-btn" onClick={() => onSearch(t.txid, 'transaction')}>Open</button>}>
            {Number.isNaN(t.delta)
              ? <span className="m26-mono">{groups(t.txid, true)}</span>
              : <span className={t.delta >= 0 ? 'm26-in' : 'm26-out'}>{t.delta >= 0 ? '+' : '−'}{zec(Math.abs(t.delta))}</span>}
          </Row>
        ))}
      </Section>
    </div>
  );
}

export function M26ZAddressView({ data }: { data: M26ZAddress }) {
  const kind = data.type === 'unified' ? 'unified' : data.type === 'orchard' ? 'Orchard' : 'Sapling';
  return (
    <div className="m26">
      <Hero eyebrow={<>Private address <Pill kind="private">Private</Pill></>}>
        A <em>private</em> {kind} address. {data.valid ? 'It is valid,' : 'It does not look valid,'} and its balance and history are encrypted, by design.
      </Hero>
      <Section title="About this address">
        <Row k="Address" hint="Share it to receive ZEC privately" help="address" action={<Copy value={data.address} />}>
          <span className="m26-mono m26-wrap">{groups(data.address)}</span>
        </Row>
        <Row k="What can be seen" hint="On the public chain" help="zaddr">Nothing beyond the address itself</Row>
        {data.message && <Row k="Note">{data.message}</Row>}
      </Section>
    </div>
  );
}

/**
 * The switch in the Explorer's title bar: the user's own theme, or minimal26.
 * The left side is named after the theme in use, so it reads as "back to
 * mine" rather than an abstract "classic".
 */
export function ModeSwitch() {
  const mode = useUiModeStore((s) => s.mode);
  const setMode = useUiModeStore((s) => s.setMode);
  const themeName = useThemeStore((s) => s.themes[s.currentTheme]?.name ?? 'Classic');
  return (
    <span className="m26-switch" role="group" aria-label="Interface">
      <button type="button" aria-pressed={mode === 'classic'} onClick={() => setMode('classic')} title={`Your theme: ${themeName}`}>{themeName}</button>
      <button type="button" aria-pressed={mode === 'minimal26'} onClick={() => setMode('minimal26')} title="Bigger, calmer, easier to read">minimal26</button>
    </span>
  );
}
