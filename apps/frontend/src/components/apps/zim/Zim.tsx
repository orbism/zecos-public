'use client';

import { UserBadges } from '@/components/ui/UserBadges';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useAuthStore } from '@/store/authStore';
import { zim, useZimStore, openZimChat, markZimUsed, type ZimMe, type ZimPerson, type ZimAvatar, type ZimPresence } from '@/store/zimStore';
import { copyText } from '@/utils/clipboard';
import Avatar, { PRESETS } from './Avatar';
import ZimIcon from './ZimIcon';
import { doorOpen, doorClose } from './sounds';

/**
 * ZIM - Zcash Instant Messenger. The buddy list.
 *
 * A nod to the buddy lists of 1997, in ZEC-OS colours: a banner, your own
 * picture and name, groups that fold, a chunky toolbar, and a door that creaks
 * when a buddy signs on and slams when one leaves. People are a handle and a
 * picture here and nothing more - no addresses, ever.
 */

const POLL_MS = 15_000;
const GOLD = '#F4B728';
const AZURE = '#3ba7ff';

type View = 'list' | 'add' | 'profile';
interface Buddies { buddies: ZimPerson[]; incoming: ZimPerson[]; outgoing: ZimPerson[] }
interface Found { id: string; handle: string; badges?: string[]; avatar: ZimAvatar; relation: 'self' | 'buddy' | 'pending-out' | 'pending-in' | 'none' }

/** Raised, bevelled - the one piece of 1997 chrome everything here is built from. */
const bevel: CSSProperties = {
  border: '1px solid rgba(0,0,0,.65)', borderRadius: 4,
  background: 'linear-gradient(#2c3346, #1d2230)',
  boxShadow: 'inset 1px 1px 0 rgba(255,255,255,.14), inset -1px -1px 0 rgba(0,0,0,.45)',
  color: 'var(--text-primary)', cursor: 'pointer', font: 'inherit',
};

/** The slug from a pasted buddy link, or the slug itself. */
function slugFrom(input: string): string {
  const t = input.trim();
  try { return new URL(t).searchParams.get('add') ?? ''; } catch { return /^[A-Za-z0-9_-]{6,32}$/.test(t) ? t : ''; }
}

/** A square picture from any image: centre-cropped, 128px, small enough to store. */
async function toAvatarData(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  c.getContext('2d')!.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 128, 128);
  for (const q of [0.85, 0.7, 0.5]) {
    const d = c.toDataURL('image/webp', q);
    if (d.startsWith('data:image/webp') && d.length < 58_000) return d;
  }
  return c.toDataURL('image/jpeg', 0.7); // browsers that cannot encode WebP
}

export default function Zim() {
  const ready = useAuthStore((s) => Boolean(s.sessionToken && s.isVerified && !s.isGuest));
  const [view, setView] = useState<View>('list');
  const [me, setMe] = useState<ZimMe | null>(null);
  const [data, setData] = useState<Buddies | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [folded, setFolded] = useState<Record<string, boolean>>({ offline: false });
  const [pendingAdd, setPendingAdd] = useState<string | null>(null);
  const lastOnline = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await zim<Buddies>('buddies');
      // Door sounds: only for changes seen while the list is open, never on the first load.
      const now = new Set(d.buddies.filter((b) => b.online).map((b) => b.id));
      const before = lastOnline.current;
      if (before) {
        if ([...now].some((id) => !before.has(id))) doorOpen();
        else if ([...before].some((id) => !now.has(id))) doorClose();
      }
      lastOnline.current = now;
      setData(d); setError(null);
      void useZimStore.getState().refreshUnread();
    } catch (e) { setError(e instanceof Error ? e.message : 'ZIM is unreachable'); }
  }, []);

  useEffect(() => {
    if (!ready) return;
    markZimUsed();
    zim<ZimMe>('me').then(setMe).catch((e) => setError(e.message));
    void load();
    const id = setInterval(load, POLL_MS);
    window.addEventListener('focus', load);
    return () => { clearInterval(id); window.removeEventListener('focus', load); };
  }, [ready, load]);

  // A shared buddy link lands here as /zim?add=<slug>.
  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get('add');
    if (slug) { setPendingAdd(slug); setView('add'); }
  }, []);

  if (!ready) {
    return (
      <Shell>
        <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
          <div style={{ fontSize: 15, color: 'var(--text-primary)', marginBottom: 6 }}>ZIM is for verified accounts.</div>
          Sign in to ZEC-OS with a verified account to message your buddies.
          <div style={{ marginTop: 12 }}><a href="/?login=1" style={{ color: AZURE, textDecoration: 'underline' }}>Sign in at ZEC-OS</a></div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Me */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,.07)' }}>
        {me ? <Avatar avatar={me.avatar} size={42} /> : <span style={{ width: 42, height: 42 }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me?.handle ?? '…'}{me && <UserBadges keys={me.badges} />}</div>
          {me && <MyStatus me={me} onChange={(m) => setMe({ ...me, ...m })} />}
        </div>
      </div>

      {/* Tabs, 1997-style */}
      <div style={{ display: 'flex', gap: 2, padding: '8px 8px 0' }}>
        {([['list', 'Buddiez'], ['add', 'Add Buddy'], ['profile', 'My Picture']] as [View, string][]).map(([v, label]) => (
          <button key={v} onClick={() => setView(v)} style={{
            ...bevel, flex: 1, padding: '5px 4px', fontSize: 11.5, fontWeight: 700, borderRadius: '5px 5px 0 0',
            borderBottom: view === v ? '1px solid transparent' : bevel.border,
            background: view === v ? 'var(--bg-window)' : bevel.background, color: view === v ? GOLD : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', margin: '0 8px', border: '1px solid rgba(0,0,0,.6)', borderTop: 'none', background: 'var(--bg-window)' }}>
        {error && <div style={{ padding: 10, color: 'var(--accent-orange)', fontSize: 12 }}>{error}</div>}
        {view === 'list' && (
          <BuddyList data={data} me={me} selected={selected} setSelected={setSelected} folded={folded}
            toggle={(g) => setFolded((f) => ({ ...f, [g]: !f[g] }))} reload={load} />
        )}
        {view === 'add' && me && <AddBuddy me={me} initial={pendingAdd} onDone={() => { void load(); }} />}
        {view === 'profile' && me && <Profile me={me} onChange={(avatar) => setMe({ ...me, avatar })} />}
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 6, padding: 8 }}>
        <ToolButton label="IM" disabled={!selected} onClick={() => {
          const p = data && [...data.buddies, ...data.incoming].find((b) => b.id === selected);
          if (p) openZimChat(p);
        }}>💬</ToolButton>
        <ToolButton label="Add" onClick={() => setView('add')}>➕</ToolButton>
        <ToolButton label="Picture" onClick={() => setView('profile')}>🖼️</ToolButton>
      </div>
    </Shell>
  );
}

/** The banner and frame every view sits in. */
function Shell({ children }: { children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'var(--font-primary, system-ui)', color: 'var(--text-primary)', background: 'var(--bg-inset)' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: 'linear-gradient(180deg, #1f4fa8 0%, #0e2c6b 55%, #0a1f4d 100%)',
        borderBottom: `2px solid ${GOLD}`, color: '#fff',
      }}>
        <span style={{ filter: 'drop-shadow(0 1px 0 rgba(0,0,0,.6))', color: '#cfe0ff' }}><ZimIcon size={30} /></span>
        <div style={{ lineHeight: 1.1 }}>
          <div style={{ fontFamily: 'var(--font-press-start, monospace)', fontSize: 15, color: GOLD, letterSpacing: 1, textShadow: '1px 1px 0 #000' }}>ZIM</div>
          <div style={{ fontSize: 10.5, color: '#cfe0ff', letterSpacing: 0.3 }}>Zcash Instant Messenger</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...bevel, flex: 1, padding: '5px 0 4px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
      opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer',
    }}>
      <span style={{ fontSize: 16, lineHeight: 1 }}>{children}</span>
      <span style={{ fontSize: 10.5, fontWeight: 700 }}>{label}</span>
    </button>
  );
}

function Group({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div>
      <button onClick={onToggle} style={{
        font: 'inherit', display: 'flex', alignItems: 'center', gap: 5, width: '100%', padding: '6px 8px 3px', background: 'none', border: 'none',
        color: 'var(--text-primary)', fontWeight: 800, fontSize: 12, cursor: 'pointer', textAlign: 'left',
      }}>
        <span style={{ fontSize: 9, color: GOLD, width: 9 }}>{open ? '▼' : '▶'}</span>{title}
      </button>
      {open && children}
    </div>
  );
}

function BuddyList({ data, me, selected, setSelected, folded, toggle, reload }: {
  data: Buddies | null; me: ZimMe | null; selected: string | null; setSelected: (id: string) => void;
  folded: Record<string, boolean>; toggle: (g: string) => void; reload: () => Promise<void>;
}) {
  const online = useMemo(() => (data?.buddies ?? []).filter((b) => b.online).sort(byName), [data]);
  const offline = useMemo(() => (data?.buddies ?? []).filter((b) => !b.online).sort(byName), [data]);
  if (!data) return <div style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>Signing on…</div>;

  const act = async (path: string, body: object) => { try { await zim(path, { method: 'POST', body }); } catch { /* list says */ } await reload(); };
  // One click (or tap) opens the chat - no double-clicking, on any device. Requests are not chats yet.
  const row = (p: ZimPerson, extra?: ReactNode, chat = true) => (
    <div key={p.id}
      onClick={() => { setSelected(p.id); if (chat) { markZimUsed(); openZimChat(p); } }}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '3px 8px 3px 20px', cursor: 'pointer',
        background: selected === p.id ? 'rgba(59,167,255,.18)' : undefined,
      }}
      title={chat ? 'Send an instant message' : undefined}
    >
      <span style={{ position: 'relative', flexShrink: 0, display: 'inline-flex', width: 24, height: 24 }}>
        <Avatar avatar={p.avatar} size={24} online={p.online} />
        {p.online && <Dot status={p.status} />}
      </span>
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13,
          fontWeight: p.online || p.unread ? 700 : 400, fontStyle: p.online ? 'normal' : 'italic',
          color: p.online ? 'var(--text-primary)' : 'var(--text-muted)',
        }}>
          {p.handle}<UserBadges keys={p.badges} size={12} />
          {p.status === 'away' && <span style={{ color: STATUS.away, fontSize: 10.5, fontWeight: 600 }}> · away</span>}
          {p.invisible && <span style={{ color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 600 }}> · invisible</span>}
          {p.sysop && <span style={{ color: GOLD, fontSize: 10.5, fontStyle: 'normal' }}> · sysop</span>}
        </span>
        {p.doing && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 11, fontStyle: 'italic', color: 'var(--text-muted)' }}>
            {p.doing}
          </span>
        )}
      </span>
      {p.unread > 0 && <span style={{ background: '#e5383b', color: '#fff', borderRadius: 8, fontSize: 10, fontWeight: 800, padding: '1px 6px' }}>{p.unread}</span>}
      {extra}
    </div>
  );
  const small = (label: string, color: string, onClick: () => void) => (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} style={{ ...bevel, padding: '1px 7px', fontSize: 10.5, fontWeight: 700, color }}>{label}</button>
  );
  const everyone = me?.sysop;

  return (
    <div style={{ paddingBottom: 6 }}>
      {data.incoming.length > 0 && (
        <Group title={`Buddy Requests (${data.incoming.length})`} open={!folded.incoming} onToggle={() => toggle('incoming')}>
          {data.incoming.map((p) => row(p, <>
            {small('Accept', 'var(--accent-green)', () => act('respond', { userId: p.id, accept: true }))}
            {small('No', 'var(--accent-orange)', () => act('respond', { userId: p.id, accept: false }))}
          </>, false))}
        </Group>
      )}
      <Group title={`${everyone ? 'Everyone' : 'Buddiez'} (${online.length}/${online.length + offline.length})`} open={!folded.online} onToggle={() => toggle('online')}>
        {online.length ? online.map((p) => row(p))
          : <div style={{ padding: '2px 20px 4px', fontSize: 11.5, color: 'var(--text-muted)' }}>Nobody online right now.</div>}
      </Group>
      <Group title={`Offline (${offline.length})`} open={!folded.offline} onToggle={() => toggle('offline')}>
        {offline.map((p) => row(p, !p.sysop && !everyone ? small('✕', 'var(--text-muted)', () => {
          if (window.confirm(`Remove ${p.handle} from your Buddiez?`)) void act('remove', { userId: p.id });
        }) : undefined))}
      </Group>
      {data.outgoing.length > 0 && (
        <Group title={`Waiting On (${data.outgoing.length})`} open={!folded.outgoing} onToggle={() => toggle('outgoing')}>
          {data.outgoing.map((p) => row(p, small('Cancel', 'var(--text-muted)', () => act('remove', { userId: p.id })), false))}
        </Group>
      )}
    </div>
  );
}

const byName = (a: ZimPerson, b: ZimPerson) => a.handle.localeCompare(b.handle);

const STATUS = { online: '#3ddc84', away: '#f0a93b', invisible: '#8a8fa3' } as const;

/** The little presence light on a buddy's picture: green online, amber away. */
function Dot({ status }: { status: ZimPerson['status'] }) {
  return (
    <span aria-hidden style={{
      position: 'absolute', right: -2, bottom: -2, width: 9, height: 9, borderRadius: '50%',
      background: status === 'away' ? STATUS.away : STATUS.online, boxShadow: '0 0 0 2px var(--bg-window)',
    }} />
  );
}

/** Your own status - Online / Away / Invisible - and what you are doing, click to edit. */
function MyStatus({ me, onChange }: { me: ZimMe; onChange: (m: Partial<ZimMe>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(me.doing ?? '');
  const [err, setErr] = useState<string | null>(null);
  const save = async (body: { presence?: ZimPresence; doing?: string | null }) => {
    setErr(null);
    try { onChange(await zim<{ presence: ZimPresence; doing: string | null }>('me/status', { method: 'PUT', body })); markZimUsed(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Not saved'); }
  };
  const commit = () => { setEditing(false); if (draft.trim() !== (me.doing ?? '')) void save({ doing: draft.trim() || null }); };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 1 }}>
      <select value={me.presence} onChange={(e) => void save({ presence: e.target.value as ZimPresence })}
        aria-label="Your status"
        style={{
          font: 'inherit', alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
          fontSize: 11, fontWeight: 700, color: STATUS[me.presence],
        }}>
        <option value="online">● Online</option>
        <option value="away">● Away</option>
        <option value="invisible">○ Invisible</option>
      </select>
      {editing ? (
        <input autoFocus value={draft} maxLength={80} placeholder="What are you doing?"
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') { setDraft(me.doing ?? ''); setEditing(false); } }}
          style={{ background: 'var(--bg-inset)', border: '1px solid var(--border-window)', color: 'var(--text-primary)', fontSize: 11.5, padding: '2px 4px' }} />
      ) : (
        <button onClick={() => { setDraft(me.doing ?? ''); setEditing(true); }} title="Set what you are doing"
          style={{
            background: 'none', border: 'none', padding: 0, textAlign: 'left', cursor: 'text', font: 'inherit', fontSize: 11.5,
            fontStyle: 'italic', color: me.doing ? 'var(--text-secondary)' : 'var(--text-muted)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{me.doing || 'What are you doing?'}</button>
      )}
      {err && <span style={{ fontSize: 11, color: 'var(--accent-orange)' }}>{err}</span>}
    </div>
  );
}

function AddBuddy({ me, initial, onDone }: { me: ZimMe; initial: string | null; onDone: () => void }) {
  const link = typeof window !== 'undefined' ? `${window.location.origin}/zim?add=${me.slug}` : '';
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState(initial ?? '');
  const [found, setFound] = useState<Found | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const lookup = useCallback(async (raw: string) => {
    setFound(null); setMsg(null);
    const slug = slugFrom(raw);
    if (!slug) { setMsg('Paste a buddy link, like the one above.'); return; }
    try { setFound({ ...(await zim<Found>(`lookup/${encodeURIComponent(slug)}`)) }); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Lookup failed'); }
  }, []);

  useEffect(() => { if (initial) void lookup(initial); }, [initial, lookup]);

  const request = async () => {
    try {
      const r = await zim<{ relation: Found['relation'] }>('request', { method: 'POST', body: { slug: slugFrom(input) } });
      setFound((f) => f && { ...f, relation: r.relation });
      onDone();
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Request failed'); }
  };

  const status: Record<Found['relation'], string> = {
    self: 'That is your own link.', buddy: 'Already your buddy.', 'pending-out': 'Request sent - waiting for them to accept.',
    'pending-in': 'They already asked you - send yours to accept.', none: '',
  };

  return (
    <div style={{ padding: 12, fontSize: 12.5, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Your buddy link</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 6 }}>
          Share it with people you want on your list. They send a request; you accept it.
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} style={{
            flex: 1, minWidth: 0, background: 'var(--bg-inset)', border: '1px solid var(--border-window)', color: AZURE,
            fontSize: 11.5, padding: '5px 6px', fontFamily: 'monospace',
          }} />
          <button style={{ ...bevel, padding: '4px 10px', fontSize: 11.5, fontWeight: 700 }}
            onClick={async () => { if (await copyText(link)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div>
        <div style={{ fontWeight: 800, marginBottom: 4 }}>Add someone</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && lookup(input)}
            placeholder="Paste their buddy link" style={{
              flex: 1, minWidth: 0, background: 'var(--bg-inset)', border: '1px solid var(--border-window)', color: 'var(--text-primary)',
              fontSize: 12, padding: '5px 6px',
            }} />
          <button style={{ ...bevel, padding: '4px 10px', fontSize: 11.5, fontWeight: 700 }} onClick={() => lookup(input)}>Find</button>
        </div>
        {msg && <div style={{ color: 'var(--accent-orange)', marginTop: 6, fontSize: 12 }}>{msg}</div>}
        {found && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, padding: 8, ...bevel, cursor: 'default' }}>
            <Avatar avatar={found.avatar} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{found.handle}<UserBadges keys={found.badges} /></div>
              {status[found.relation] && <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{status[found.relation]}</div>}
            </div>
            {(found.relation === 'none' || found.relation === 'pending-in') && (
              <button onClick={request} style={{ ...bevel, padding: '5px 10px', fontSize: 11.5, fontWeight: 800, color: GOLD }}>
                {found.relation === 'pending-in' ? 'Accept' : 'Send request'}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Profile({ me, onChange }: { me: ZimMe; onChange: (a: ZimAvatar) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const save = async (body: object) => {
    setBusy(true); setMsg(null);
    try { onChange((await zim<{ avatar: ZimAvatar }>('me/avatar', { method: 'PUT', body })).avatar); }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ padding: 12, fontSize: 12.5, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
      <Avatar avatar={me.avatar} size={112} />
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.5 }}>
        Buddiez see your name and this picture. Never your address.
      </div>
      <div style={{ display: 'flex', gap: 6, width: '100%' }}>
        <button disabled={busy} style={{ ...bevel, flex: 1, padding: '6px 4px', fontSize: 12, fontWeight: 700 }}
          onClick={() => save({ kind: 'gen', seed: Math.random().toString(36).slice(2, 12) })}>🎲 Re-roll face</button>
        <button disabled={busy} style={{ ...bevel, flex: 1, padding: '6px 4px', fontSize: 12, fontWeight: 700 }}
          onClick={() => file.current?.click()}>⬆ Upload</button>
        <input ref={file} type="file" accept="image/*" hidden onChange={async (e) => {
          const f = e.target.files?.[0]; e.target.value = '';
          if (!f) return;
          try { await save({ kind: 'upload', data: await toAvatarData(f) }); }
          catch { setMsg('That image could not be read'); }
        }} />
      </div>
      <div style={{ alignSelf: 'stretch', fontWeight: 800, marginTop: 4 }}>Or pick one</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 6, alignSelf: 'stretch', justifyItems: 'center' }}>
        {Object.entries(PRESETS).map(([id, p]) => (
          <button key={id} title={p.label} disabled={busy} onClick={() => save({ kind: 'preset', seed: id })}
            style={{ padding: 0, border: me.avatar.kind === 'preset' && me.avatar.seed === id ? `2px solid ${GOLD}` : '2px solid transparent', borderRadius: 6, background: 'none', cursor: 'pointer' }}>
            <Avatar avatar={{ kind: 'preset', seed: id }} size={48} />
          </button>
        ))}
        {/* The account's own generated face, to go back to */}
        <button title="Your original face" disabled={busy} onClick={() => save({ kind: 'gen', seed: me.id })}
          style={{ padding: 0, border: me.avatar.kind === 'gen' && me.avatar.seed === me.id ? `2px solid ${GOLD}` : '2px solid transparent', borderRadius: 6, background: 'none', cursor: 'pointer' }}>
          <Avatar avatar={{ kind: 'gen', seed: me.id }} size={48} />
        </button>
      </div>
      {msg && <div style={{ color: 'var(--accent-orange)', fontSize: 12 }}>{msg}</div>}
    </div>
  );
}
