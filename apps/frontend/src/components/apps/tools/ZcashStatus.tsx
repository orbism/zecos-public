'use client';

import { useMemo, useState } from 'react';
import { create } from 'zustand';
import { useApiHealth } from '@/hooks/useZecData';
import { useHealth, CHAIN_WORDS } from '@/hooks/useHealth';
import { UPGRADES, HISTORY, SERVERS } from '@/data/upgrades';
import { WALLETS, WALLETS_SOURCE, type Readiness } from '@/data/wallets';
import { VENUES } from '@/data/exchanges';
import { ReportOutdated } from '@/components/beta/ReportOutdated';
import { openApp } from '@/lib/openApp';
import { FS, Tag, Card, Tags, CardTitle, Body, Sources, Picker, inputStyle, type Tone } from '@/components/ui/InfoTag';

/**
 * Zcash Status: is it me or Zcash? The network as ZEC-OS sees it, every
 * upgrade from Sapling to NU7, whether a wallet, device, exchange or node is
 * ready for them, and the public light-wallet servers.
 */

type Tab = 'network' | 'upgrades' | 'readiness' | 'servers';

/** Which tab to open on, for links that open this app (the network flyout). */
export const useStatusTab = create<{ tab: Tab; set: (t: Tab) => void }>((set) => ({ tab: 'network', set: (tab) => set({ tab }) }));

type Group = 'Wallet' | 'Hardware' | 'Exchange' | 'Swap' | 'Node' | 'Server';
interface Row { name: string; group: Group; ironwood: Readiness | 'n/a'; nu7: string; shielded: string | null; note?: string | null; url: string }

const NU7_NOT_YET = 'not announced yet';

function readinessRows(): Row[] {
  const wallets: Row[] = WALLETS.map((w) => ({
    name: w.name, group: w.kind === 'hardware' ? 'Hardware' : 'Wallet',
    ironwood: w.kind === 'transparent-only' ? 'n/a' : w.ironwood,
    nu7: w.kind === 'sunset' ? 'discontinued' : NU7_NOT_YET,
    shielded: w.kind === 'transparent-only' ? 'transparent only' : w.kind === 'sunset' ? null : w.pools.filter((p) => p !== 'Transparent').join(', ') || null,
    note: w.note, url: w.url,
  }));
  const venues: Row[] = VENUES.map((v) => {
    const gone = v.deposit.issues === 'none' && v.withdraw.transparent === false;
    return {
      name: v.name, group: v.kind === 'instant-swap' || v.kind === 'dex' ? 'Swap' : 'Exchange',
      ironwood: gone ? 'n/a' : v.withdraw.shielded ? (v.id === 'gemini' || v.id === 'leodex' ? 'ready' : 'unknown') : v.withdraw.transparent ? 'n/a' : 'unknown',
      nu7: gone ? 'no ZEC' : NU7_NOT_YET,
      shielded: gone ? null : v.withdraw.shielded ? 'pays out shielded' : v.withdraw.transparent ? 'transparent only' : null,
      note: gone ? (v.regions[0]?.note ?? v.notes) : v.notes, url: v.url,
    };
  });
  const nodes: Row[] = [
    { name: 'Zebra', group: 'Node', ironwood: 'ready', nu7: NU7_NOT_YET, shielded: null, note: 'The Zcash Foundation full node.', url: 'https://github.com/ZcashFoundation/zebra' },
    { name: 'Zakura', group: 'Node', ironwood: 'ready', nu7: NU7_NOT_YET, shielded: null, note: 'ZODL\'s node; Gemini moved its Zcash node to it.', url: 'https://github.com/zodl-inc' },
    { name: 'zcashd', group: 'Node', ironwood: 'not-ready', nu7: 'end of life', shielded: null, note: 'End of life since 2026-07-18, no Ironwood support. Move to Zebra (or Zakura) plus Zallet.', url: 'https://zcash.github.io/zcash/user/end-of-life.html' },
    { name: 'Zaino', group: 'Server', ironwood: 'unknown', nu7: NU7_NOT_YET, shielded: null, note: 'Rust indexer replacing lightwalletd; v0.8.0 in Aug 2026.', url: 'https://github.com/zingolabs/zaino' },
    { name: 'lightwalletd', group: 'Server', ironwood: 'unknown', nu7: NU7_NOT_YET, shielded: null, note: 'The original Go light-wallet server.', url: 'https://github.com/zcash/lightwalletd' },
  ];
  return [...nodes, ...wallets, ...venues];
}

const READY_TONE: Record<string, Tone> = { ready: 'ok', 'in-progress': 'warn', 'not-ready': 'bad', unknown: 'muted', 'n/a': 'muted' };
const READY_WORD: Record<string, string> = { ready: 'ready', 'in-progress': 'in progress', 'not-ready': 'not ready', unknown: 'not stated', 'n/a': 'does not apply' };
const READY_RANK: Record<string, number> = { ready: 0, 'in-progress': 1, unknown: 2, 'n/a': 3, 'not-ready': 4 };

// ── Network ─────────────────────────────────────────────────────────────────
function Network() {
  const h = useApiHealth(30_000);
  const health = useHealth();
  const nu7 = UPGRADES.find((u) => u.id === 'nu7')!;
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Card accent={h.healthy ? 'ok' : h.healthy === false ? 'bad' : undefined}>
        <CardTitle>ZEC-OS connection</CardTitle>
        <Tags>
          <Tag label="Status" value={h.healthy === null ? 'checking...' : h.healthy ? 'connected' : 'offline'} tone={h.healthy ? 'ok' : h.healthy === false ? 'bad' : 'muted'} />
          <Tag label="Latency" value={h.latency !== null ? `${h.latency} ms` : '-'} tone={h.latency !== null && h.latency < 500 ? 'ok' : 'warn'} />
          {Object.entries(health.chains).filter(([, s]) => s !== 'off').map(([k, s]) => (
            <Tag key={k} label={k} value={CHAIN_WORDS[s].label} tone={CHAIN_WORDS[s].tone === 'ok' ? 'ok' : CHAIN_WORDS[s].tone === 'warn' ? 'warn' : 'muted'} />
          ))}
        </Tags>
      </Card>
      <Card>
        <CardTitle>The chain</CardTitle>
        <Tags>
          <Tag label="Block height" value={h.blockHeight ? `#${h.blockHeight.toLocaleString('en-US')}` : '-'} tone="gold" />
          <Tag label="Shielded" value={h.shieldedPercent !== null ? `${h.shieldedPercent.toFixed(1)}% of supply` : '-'} tone="ok" />
          <Tag label="Total shielded" value={h.totalShielded ? `${(h.totalShielded / 1e6).toFixed(2)}M ZEC` : '-'} />
          <Tag label="ZEC" value={h.priceUsd ? `$${h.priceUsd.toFixed(2)}` : '-'} />
          <Tag label="Pool" value="Ironwood live" tone="ok" />
          <Tag label="Next upgrade" value="NU7" tone="warn" />
        </Tags>
        <Body>{nu7.line}</Body>
      </Card>
      <Card>
        <CardTitle>Is it me or Zcash?</CardTitle>
        <Body>
          <ol className="list-decimal pl-5 space-y-1.5">
            <li>If this page says connected, the chain is fine. A wallet that will not sync is usually talking to a light-wallet server that is down or slow: check the Servers tab, or switch servers in your wallet&apos;s settings.</li>
            <li>Update the wallet app. After an upgrade, old versions stop working.</li>
            <li>Using Tor? Sync is slower over Tor; give it time.</li>
            <li>Balance missing after a restore? That is usually the birthday height, not the network.</li>
          </ol>
        </Body>
        <Tags>
          <button className="btn-window px-3 py-1.5" onClick={() => useStatusTab.getState().set('servers')}>Servers →</button>
          <button className="btn-window px-3 py-1.5" onClick={() => openApp('rescue-kit')}>Rescue Kit →</button>
          <button className="btn-window px-3 py-1.5" onClick={() => openApp('explorer')}>Explorer →</button>
        </Tags>
      </Card>
    </div>
  );
}

// ── Upgrades ────────────────────────────────────────────────────────────────
function Upgrades() {
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      {UPGRADES.map((u) => (
        <Card key={u.id} accent={u.status === 'live' ? 'ok' : 'warn'}>
          <CardTitle right={<Tag value={u.status} tone={u.status === 'live' ? 'ok' : 'warn'} />}>{u.name}</CardTitle>
          <Body>{u.line}</Body>
          <div>
            <div className="text-[var(--text-primary)] font-bold mb-1" style={{ fontSize: FS.body }}>What changes</div>
            <Body><ul className="list-disc pl-5 space-y-1">{u.changes.map((c) => <li key={c}>{c}</li>)}</ul></Body>
          </div>
          <div>
            <div className="text-[var(--text-primary)] font-bold mb-1" style={{ fontSize: FS.body }}>What it means for you</div>
            <Body><ul className="list-disc pl-5 space-y-1">{u.forYou.map((c) => <li key={c}>{c}</li>)}</ul></Body>
          </div>
          <Sources list={u.sources} />
        </Card>
      ))}
      <Card>
        <CardTitle>Every settled upgrade</CardTitle>
        <div className="flex flex-col" style={{ gap: 12 }}>
          {HISTORY.map((u) => (
            <div key={u.name} className="flex flex-col gap-1.5">
              <Tags>
                <a href={`https://github.com/zcash/zips/blob/main/zips/${u.zip}`} target="_blank" rel="noopener noreferrer"><Tag value={u.name} tone="gold" /></a>
                <Tag label="Block" value={u.height.toLocaleString('en-US')} />
                <Tag label="Date" value={u.date} tone="muted" />
              </Tags>
              <Body>{u.what}</Body>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Readiness ───────────────────────────────────────────────────────────────
type RSort = 'group' | 'ironwood' | 'name';
const GROUPS: Group[] = ['Wallet', 'Hardware', 'Exchange', 'Swap', 'Node', 'Server'];

function ReadinessTab() {
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<'all' | Group>('all');
  const [sort, setSort] = useState<RSort>('group');
  const all = useMemo(readinessRows, []);
  const rows = all
    .filter((r) => (group === 'all' || r.group === group) && (!q || `${r.name} ${r.group} ${r.note ?? ''}`.toLowerCase().includes(q.toLowerCase())))
    .sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name)
      : sort === 'ironwood' ? (a, b) => READY_RANK[a.ironwood]! - READY_RANK[b.ironwood]! || a.name.localeCompare(b.name)
      : (a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group) || READY_RANK[a.ironwood]! - READY_RANK[b.ironwood]! || a.name.localeCompare(b.name));
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Check anything: a wallet, a device, an exchange, a node"
        className={inputStyle} style={{ borderRadius: 8, fontSize: FS.input }} />
      <div className="flex flex-wrap gap-3">
        <Picker label="Show" value={group} onChange={setGroup} options={[['all', `All (${all.length})`], ...GROUPS.map((g) => [g, `${g} (${all.filter((r) => r.group === g).length})`] as [Group, string])]} />
        <Picker label="Sort" value={sort} onChange={setSort} options={[['group', 'By type'], ['ironwood', 'Ironwood ready first'], ['name', 'Name A to Z']]} />
      </div>
      <Body>NU7 readiness fills in as projects announce it. Nothing is guessed: &quot;not stated&quot; means we have not seen a statement.</Body>
      {rows.map((r) => (
        <Card key={`${r.group}-${r.name}`}>
          <CardTitle href={r.url} right={<Tag value={r.group} tone="gold" />}>{r.name}</CardTitle>
          <Tags>
            <Tag label="Ironwood" value={READY_WORD[r.ironwood]} tone={READY_TONE[r.ironwood]} />
            <Tag label="NU7" value={r.nu7} tone={r.nu7 === NU7_NOT_YET ? 'muted' : 'bad'} />
            {r.shielded && <Tag label="Shielded" value={r.shielded} tone={r.shielded === 'transparent only' ? 'warn' : 'ok'} />}
          </Tags>
          {r.note && <Body>{r.note}</Body>}
        </Card>
      ))}
      {rows.length === 0 && <Body>Nothing matches. It may not be listed yet.</Body>}
      <Sources list={[{ label: WALLETS_SOURCE.label, url: WALLETS_SOURCE.url }]} />
      <ReportOutdated what="something out of date" />
    </div>
  );
}

// ── Servers ─────────────────────────────────────────────────────────────────
function Servers() {
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Card accent="gold">
        <CardTitle>Live health</CardTitle>
        <Body>Your wallet talks to a light-wallet server, not straight to the chain. These two dashboards show which servers are up right now.</Body>
        <Tags>
          <a href="https://hosh.zec.rocks/zec" target="_blank" rel="noopener noreferrer"><Tag value="hosh.zec.rocks: server health" tone="gold" /></a>
          <a href="https://status.zec.rocks/" target="_blank" rel="noopener noreferrer"><Tag value="status.zec.rocks: service status" tone="gold" /></a>
        </Tags>
      </Card>
      {SERVERS.map((s) => (
        <Card key={s.host}>
          <CardTitle right={<Tag value={s.kind} tone={s.kind === 'lightwalletd' ? 'ok' : 'warn'} />}><code>{s.host}</code></CardTitle>
          <Body>{s.note}</Body>
        </Card>
      ))}
      <Card>
        <CardTitle>What a server can and cannot see</CardTitle>
        <Tags>
          <Tag value="✗ your keys or seed" tone="ok" />
          <Tag value="✗ spend your funds" tone="ok" />
          <Tag value="✗ shielded amounts and memos" tone="ok" />
          <Tag value="✓ your IP address" tone="bad" />
          <Tag value="✓ when you send and receive" tone="bad" />
        </Tags>
        <Body>Tor hides your IP from the server (in Zodl it is in Advanced Settings), at the cost of slower sync. Running your own server (lightwalletd or Zaino on top of Zebra) removes the trust question entirely.</Body>
        <Sources list={[
          { label: 'ZecHub: light-wallet nodes', url: 'https://github.com/zechub/zechub/blob/main/site/Zcash_Tech/Lightwallet_Nodes.md' },
          { label: 'Zcash wallet threat model', url: 'https://zcash.readthedocs.io/en/latest/rtd_pages/wallet_threat_model.html' },
        ]} />
      </Card>
    </div>
  );
}

const TABS: [Tab, string][] = [['network', 'Network'], ['upgrades', 'Upgrades'], ['readiness', 'Readiness'], ['servers', 'Servers']];

export default function ZcashStatus() {
  const { tab, set } = useStatusTab();
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex gap-2 px-4 pt-3 shrink-0 flex-wrap">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => set(id)} className="btn-window px-3 py-1.5"
            style={{ fontSize: FS.body, color: tab === id ? 'var(--accent-gold)' : 'var(--text-secondary)', borderColor: tab === id ? 'var(--accent-gold)' : undefined }}>{label}</button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto" style={{ padding: 16 }}>
        {tab === 'network' && <Network />}
        {tab === 'upgrades' && <Upgrades />}
        {tab === 'readiness' && <ReadinessTab />}
        {tab === 'servers' && <Servers />}
      </div>
    </div>
  );
}
