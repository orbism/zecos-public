import { create } from 'zustand';
import { useAuthStore } from '@/store/authStore';
import { useWindowStore } from '@/store/windowStore';
import { calculateWindowPosition } from '@/utils/windowPlacement';
import { APP_META } from '@/config/appMeta';

/** How a picture is described: generated from a seed, a named preset, or an uploaded image. */
export type ZimAvatar = { kind: 'gen' | 'preset'; seed: string } | { kind: 'upload'; data: string };

export interface ZimPerson {
  id: string;
  handle: string;
  badges?: string[];
  avatar: ZimAvatar;
  online: boolean;
  /** 'away' is still online; someone invisible reads as 'offline' (the sysop sees `invisible`). */
  status: 'online' | 'away' | 'offline';
  doing: string | null;
  invisible?: boolean;
  sysop: boolean;
  unread: number;
}

export type ZimPresence = 'online' | 'away' | 'invisible';

export interface ZimMe { id: string; handle: string; badges?: string[]; slug: string; avatar: ZimAvatar; sysop: boolean; presence: ZimPresence; doing: string | null }

/** A verified session is the only way in; guests and signed-out visitors get nothing to call. */
export function zimReady(): boolean {
  const a = useAuthStore.getState();
  return Boolean(a.sessionToken && a.isVerified && !a.isGuest);
}

/** Calls /api/im/*, signed. Resolves to the JSON, or throws the server's error text. */
export async function zim<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const token = useAuthStore.getState().sessionToken;
  const r = await fetch(`/api/im/${path}`, {
    method: init?.method ?? 'GET', cache: 'no-store',
    headers: { Authorization: `Bearer ${token ?? ''}`, ...(init?.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((d as { error?: string }).error ?? `ZIM error ${r.status}`);
  return d as T;
}

/** The unread total, shared by the taskbar badge and the buddy list. */
export const useZimStore = create<{ unread: number; refreshUnread: () => Promise<void> }>((set) => ({
  unread: 0,
  refreshUnread: async () => {
    if (!zimReady()) { set({ unread: 0 }); return; }
    try { set({ unread: (await zim<{ total: number }>('unread')).total }); } catch { /* next tick */ }
  },
}));

/**
 * When ZIM was last actually used (opened, a chat read, a message sent), and
 * when it last spoke up. The cheesy announcement plays once, and then only
 * again after ZIM has gone unused for a while with messages still waiting.
 */
export const ZIM_QUIET_MS = 10 * 60_000;
let lastUsed = 0;
let lastSaid = 0;
export const markZimUsed = () => { lastUsed = Date.now(); };
export const markZimSaid = () => { lastSaid = Date.now(); };
export const zimMaySpeak = () => !lastSaid || Date.now() - Math.max(lastSaid, lastUsed) > ZIM_QUIET_MS;

export const ZIM_CHAT_PREFIX = 'zim-chat-';

/** Opens (or brings forward) the chat window with one person. */
export function openZimChat(p: Pick<ZimPerson, 'id' | 'handle'>) {
  const app = APP_META.find((a) => a.id === 'zim-chat')!;
  const ws = useWindowStore.getState();
  ws.openWindow({
    id: `${ZIM_CHAT_PREFIX}${p.id}`, type: app.id, title: `${p.handle} · Instant Message`,
    size: app.defaultSize, minSize: app.minSize,
    position: calculateWindowPosition(ws.windows, app.defaultSize, window.innerWidth, window.innerHeight),
  });
}

/** Opens the buddy list itself. */
export function openZim() {
  const app = APP_META.find((a) => a.id === 'zim')!;
  const ws = useWindowStore.getState();
  ws.openWindow({
    id: app.id, type: app.id, title: app.title, size: app.defaultSize, minSize: app.minSize,
    position: calculateWindowPosition(ws.windows, app.defaultSize, window.innerWidth, window.innerHeight),
  });
}
