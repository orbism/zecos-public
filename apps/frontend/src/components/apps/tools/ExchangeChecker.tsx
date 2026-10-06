'use client';

import { useMemo, useState } from 'react';
import { VENUES, GLOBAL_RULES, STALE_DAYS, type Venue } from '@/data/exchanges';
import { detectAddress, t1ToTex, texToT1, type AddrInfo } from '@/lib/zaddr';
import { ReportOutdated } from '@/components/beta/ReportOutdated';
import { FS, Tag, YesNo, Card, Tags, CardTitle, Body, Sources, Picker, inputStyle, type Tone } from '@/components/ui/InfoTag';
import { copyText } from '@/utils/clipboard';

/**
 * Exchange Checker: before you send, see whether an exchange or swap will take
 * the address you have, and convert t1 and TEX addresses (ZIP 320).
 *
 * Everything here runs in the browser. The venue list is curated by hand
 * (src/data/exchanges.ts); every card shows its sources and how old it is.
 */

const KIND_LABEL: Record<Venue['kind'], string> = { exchange: 'Exchange', broker: 'Broker', 'instant-swap': 'Instant swap', dex: 'DEX / intents' };
const STATUS_TONE: Record<string, Tone> = { available: 'ok', relisted: 'ok', delisted: 'bad', unavailable: 'bad', 'ban-scheduled': 'warn' };
const CONF: Record<Venue['confidence'], [string, Tone]> = {
  official: ['official source', 'ok'], wiki: ['ZecHub wiki', 'info'], snippet: ['from search results', 'warn'], unverified: ['unverified', 'muted'],
};

const daysSince = (d: string) => Math.floor((Date.now() - new Date(`${d}T00:00:00Z`).getTime()) / 86_400_000);

type Verdict = { tone: 'ok' | 'warn' | 'bad' | 'unknown'; text: string };

/** Will this address work with this venue, in this direction? */
function judge(info: AddrInfo, v: Venue, dir: 'withdraw' | 'deposit'): Verdict {
  if (info.kind === 'unknown') return { tone: 'bad', text: 'That is not a Zcash address we recognise.' };
  if (info.network === 'testnet') return { tone: 'bad', text: 'That is a testnet address. Exchanges use mainnet.' };
  if (info.kind === 'sprout') return { tone: 'bad', text: 'Sprout (zc) addresses are legacy. After NU7, funds left in Sprout become unspendable: move them out now with a recovery-capable wallet.' };

  if (dir === 'withdraw') {
    const w = v.withdraw;
    if (info.kind === 'transparent-p2pkh' || info.kind === 'transparent-p2sh') {
      return w.transparent === false ? { tone: 'bad', text: `${v.name} does not pay out to transparent addresses.` }
        : w.transparent ? { tone: 'ok', text: `${v.name} pays out to transparent addresses. Shield the funds once they land.` }
        : { tone: 'unknown', text: 'Unknown. Try a small amount first.' };
    }
    if (info.kind === 'tex') {
      return { tone: 'warn', text: `TEX addresses are for receiving at exchanges that ask for them. To withdraw from ${v.name}, use the matching t1 address (convert it below).` };
    }
    if (info.kind === 'sapling') {
      return w.shielded ? { tone: 'ok', text: `${v.name} pays out to shielded addresses.` }
        : w.shielded === false ? { tone: 'bad', text: `${v.name} only pays out to transparent addresses. Use a t-address, then shield it in your wallet.` }
        : { tone: 'unknown', text: 'Unknown whether it pays out to shielded addresses. Try a small amount first.' };
    }
    // unified
    if (w.unified) return { tone: 'ok', text: `${v.name} accepts unified (u1) addresses.` };
    if (w.unified === false && w.shielded) return { tone: 'warn', text: `${v.name} pays out shielded, but its form rejects u1. Use a Sapling (zs1) address from your wallet instead.` };
    if (w.unified === false) return { tone: 'bad', text: `${v.name}'s form rejects u1 addresses and pays out to transparent only. Use your wallet's t-address, then shield.` };
    return { tone: 'unknown', text: 'Unknown whether its form takes u1. If it refuses, use a t-address and shield after.' };
  }

  // deposit: sending FROM this address TO the venue
  const d = v.deposit;
  if (d.issues === 'none') return { tone: 'bad', text: `${v.name} does not accept ZEC deposits.` };
  if (!info.shielded) {
    return v.texRequired ? { tone: 'ok', text: `Fine: ${v.name} wants funds from a transparent address, and this is one. Send to the TEX address it gives you.` }
      : { tone: 'ok', text: 'Transparent to transparent works everywhere that takes ZEC. Remember this leg is public.' };
  }
  if (d.fromShielded === false) return { tone: 'bad', text: `Will bounce: ${v.name} rejects deposits sent from shielded addresses. Unshield to a t-address you own first, then send from that.` };
  if (d.fromShielded) return { tone: 'ok', text: `${v.name} accepts deposits sent from a shielded wallet.` };
  return { tone: 'unknown', text: `Not verified whether ${v.name} accepts deposits from shielded wallets. Send a small test amount first.` };
}

function Checker() {
  const [addr, setAddr] = useState('');
  const [venueId, setVenueId] = useState('binance');
  const [dir, setDir] = useState<'withdraw' | 'deposit'>('deposit');
  const info = addr.trim() ? detectAddress(addr) : null;
  const venue = VENUES.find((v) => v.id === venueId)!;
  const verdict = info ? judge(info, venue, dir) : null;
  const sorted = useMemo(() => [...VENUES].sort((a, b) => a.name.localeCompare(b.name)), []);

  return (
    <Card accent="gold">
      <CardTitle>Will it work?</CardTitle>
      <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="Paste a Zcash address (t1, tex1, zs1, u1)" spellCheck={false}
        className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />
      <div className="flex flex-wrap gap-3">
        <Picker label="I am" value={dir} onChange={setDir} options={[['deposit', 'sending FROM this address to'], ['withdraw', 'withdrawing TO this address from']]} />
        <Picker label="Venue" value={venueId} onChange={setVenueId} options={sorted.map((v) => [v.id, v.name] as [string, string])} />
      </div>
      {info && (
        <Tags>
          <Tag label="Detected" value={info.label} tone={info.kind === 'unknown' ? 'bad' : 'gold'} />
          {info.network && <Tag label="Network" value={info.network} tone={info.network === 'mainnet' ? 'ok' : 'warn'} />}
          {info.checksum !== null && <Tag label="Checksum" value={info.checksum ? 'ok' : 'fails: check for a typo'} tone={info.checksum ? 'ok' : 'bad'} />}
        </Tags>
      )}
      {verdict && (
        <div style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid currentColor', fontSize: FS.body, lineHeight: 1.5,
          color: verdict.tone === 'ok' ? 'var(--accent-green)' : verdict.tone === 'warn' ? '#ffb347' : verdict.tone === 'bad' ? 'var(--accent-orange)' : 'var(--text-muted)' }}>
          {verdict.text}
          {(venue.confidence === 'snippet' || venue.confidence === 'unverified') && <span className="text-[var(--text-muted)]"> ({venue.name}&apos;s data is {CONF[venue.confidence][0]}.)</span>}
        </div>
      )}
      {!verdict && <Body>Paste an address and pick where it is going. Nothing leaves your browser.</Body>}
      <Tags><Tag value="green = works" tone="ok" /><Tag value="amber = works with a change" tone="warn" /><Tag value="red = will fail" tone="bad" /></Tags>
    </Card>
  );
}

function TexTool() {
  const [v, setV] = useState('');
  const [copied, setCopied] = useState(false);
  const s = v.trim();
  // '' = nothing typed yet, undefined = not a t1/tex1 string, null = failed checksum or length
  const out = !s ? '' : /^tex1/i.test(s) ? texToT1(s) : /^t1/.test(s) ? t1ToTex(s) : undefined;
  return (
    <Card>
      <CardTitle>t1 ⇄ TEX converter (ZIP 320)</CardTitle>
      <Body>A TEX address is the same transparent address, marked so wallets only pay it from transparent funds. Binance asks for it. Only t1 addresses have a TEX form.</Body>
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder="t1... or tex1..." spellCheck={false}
        className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />
      {out === undefined && <Tag value="Paste a t1 or tex1 address" tone="bad" />}
      {out === null && <Tag value={`Not a valid ${/^tex1/i.test(s) ? 'TEX' : 't1'} address (checksum or length failed)`} tone="bad" />}
      {out && (
        <div className="flex items-center gap-3">
          <code className="flex-1 min-w-0 break-all text-[var(--text-green)]" style={{ fontSize: FS.body }}>{out}</code>
          <button className="btn-window px-3 py-1" onClick={() => { copyText(out); setCopied(true); setTimeout(() => setCopied(false), 1200); }}>{copied ? '✓ Copied' : 'Copy'}</button>
        </div>
      )}
    </Card>
  );
}

function VenueCard({ v }: { v: Venue }) {
  const age = daysSince(v.lastChecked);
  const [conf, confTone] = CONF[v.confidence];
  return (
    <Card>
      <CardTitle href={v.url} right={<><Tag value={KIND_LABEL[v.kind]} tone="gold" /><Tag value={conf} tone={confTone} /></>}>{v.name}</CardTitle>
      <Tags>
        <Tag label="Deposit address" value={v.deposit.issues === 'none' ? 'not supported' : v.deposit.issues ?? 'unknown'} tone={v.deposit.issues === 'none' ? 'bad' : v.deposit.issues ? 'info' : 'muted'} />
        {v.deposit.issues !== 'none' && <YesNo label="From a shielded wallet" v={v.deposit.fromShielded} yes="accepted" no="bounces" />}
        {v.texRequired && <Tag label="TEX" value="required" tone="warn" />}
        {v.depositTime && <Tag label="Deposit time" value={v.depositTime} />}
      </Tags>
      <Tags>
        <YesNo label="Withdraw to t-address" v={v.withdraw.transparent} />
        <YesNo label="Withdraw shielded" v={v.withdraw.shielded} />
        <YesNo label="u1 in the form" v={v.withdraw.unified} />
      </Tags>
      {v.notes && <Body>{v.notes}</Body>}
      {v.regions.length > 0 && (
        <div className="flex flex-col gap-2">
          {v.regions.map((r, i) => (
            <div key={i} className="flex flex-wrap items-start gap-2">
              <Tag label={r.region} value={`${r.status.replace('-', ' ')}${r.date ? ` · ${r.date}` : ''}`} tone={STATUS_TONE[r.status]} />
              <span className="text-[var(--text-muted)] flex-1 min-w-[180px]" style={{ fontSize: FS.small, lineHeight: 1.5, paddingTop: 4 }}>{r.note}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Tag label="Checked" value={age > STALE_DAYS ? `${v.lastChecked} · may be stale` : v.lastChecked} tone={age > STALE_DAYS ? 'warn' : 'muted'} />
        <Sources list={v.sources} />
      </div>
    </Card>
  );
}

type Sort = 'name' | 'shieldedOut' | 'shieldedIn' | 'confidence' | 'checked' | 'kind';
const CONF_RANK: Record<Venue['confidence'], number> = { official: 0, wiki: 1, snippet: 2, unverified: 3 };
const triRank = (t: boolean | null) => (t === true ? 0 : t === null ? 1 : 2);

export default function ExchangeChecker() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState<'all' | Venue['kind']>('all');
  const [sort, setSort] = useState<Sort>('shieldedOut');
  const [listedOnly, setListedOnly] = useState(true);

  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const rows = VENUES.filter((v) =>
      (kind === 'all' || v.kind === kind)
      && (!listedOnly || v.deposit.issues !== 'none' || v.withdraw.transparent !== false)
      && (!s || `${v.name} ${v.notes} ${v.regions.map((r) => `${r.region} ${r.note}`).join(' ')}`.toLowerCase().includes(s)));
    const by: Record<Sort, (a: Venue, b: Venue) => number> = {
      name: (a, b) => a.name.localeCompare(b.name),
      shieldedOut: (a, b) => triRank(a.withdraw.shielded) - triRank(b.withdraw.shielded) || CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || a.name.localeCompare(b.name),
      shieldedIn: (a, b) => triRank(a.deposit.fromShielded) - triRank(b.deposit.fromShielded) || a.name.localeCompare(b.name),
      confidence: (a, b) => CONF_RANK[a.confidence] - CONF_RANK[b.confidence] || a.name.localeCompare(b.name),
      checked: (a, b) => b.lastChecked.localeCompare(a.lastChecked) || a.name.localeCompare(b.name),
      kind: (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
    };
    return rows.sort(by[sort]);
  }, [q, kind, sort, listedOnly]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto" style={{ padding: 16, gap: 16 }}>
      <Checker />
      <TexTool />

      <Card accent="warn">
        <CardTitle>Rules that apply everywhere</CardTitle>
        {GLOBAL_RULES.map((r) => (
          <div key={r.title} className="flex flex-wrap items-start gap-2">
            <a href={r.url} target="_blank" rel="noopener noreferrer"><Tag value={r.title} tone="warn" /></a>
            <span className="flex-1 min-w-[200px] text-[var(--text-secondary)]" style={{ fontSize: FS.body, lineHeight: 1.5, paddingTop: 4 }}>{r.body}</span>
          </div>
        ))}
      </Card>

      <div className="flex flex-col gap-3" style={{ position: 'sticky', top: -16, zIndex: 2, background: 'var(--bg-window)', padding: '12px 0' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a venue, a country, a note"
          className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />
        <div className="flex flex-wrap items-center gap-3">
          <Picker label="Sort" value={sort} onChange={setSort} options={[
            ['shieldedOut', 'Pays out shielded first'], ['shieldedIn', 'Takes shielded deposits first'], ['confidence', 'Best sourced first'],
            ['checked', 'Most recently checked'], ['kind', 'By kind'], ['name', 'Name A to Z'],
          ]} />
          <Picker label="Show" value={kind} onChange={setKind} options={[['all', 'All kinds'], ...Object.entries(KIND_LABEL) as [Venue['kind'], string][]]} />
          <label className="flex items-center gap-2 text-[var(--text-secondary)]" style={{ fontSize: FS.body }}>
            <input type="checkbox" checked={listedOnly} onChange={(e) => setListedOnly(e.target.checked)} />hide venues without ZEC
          </label>
        </div>
        <span className="text-[var(--text-muted)]" style={{ fontSize: FS.body }}>{list.length} of {VENUES.length} venues · ? means not verified, never no</span>
      </div>

      {list.map((v) => <VenueCard key={v.id} v={v} />)}
      {list.length === 0 && <Body>Nothing matches.</Body>}

      <div className="pb-2"><ReportOutdated what="an out-of-date card" /></div>
    </div>
  );
}
