'use client';

import dynamic from 'next/dynamic';
import { APP_META, type AppMeta } from './appMeta';

// The app registry = pure metadata (./appMeta) joined with the actual components.
//
// The split exists because most app components are client-only
// (`dynamic(..., { ssr: false })`), which a Server Component may not import -
// while the standalone `/<app>` route needs titles/ids on the server for
// metadata, static params and 404s. Metadata lives in ./appMeta; this file adds
// the components. Keep both keyed by the same app id.

export type { AppCategory, AppMeta, StandaloneMode } from './appMeta';
export { APP_META, getStandaloneMode, getStandaloneMeta, listStandaloneApps } from './appMeta';

export interface AppConfig extends AppMeta {
  /** Always equal to `id`; kept for the window-store contract. */
  type: string;
  component: React.ComponentType;
  showOnDesktop?: boolean;
}

// Eagerly-loaded components
import { PriceTicker } from '@/components/apps/PriceTicker';
import { BlockHeight } from '@/components/apps/BlockHeight';
import { Difficulty } from '@/components/apps/Difficulty';
import { TransparentPool } from '@/components/apps/TransparentPool';
import { ShieldedPool } from '@/components/apps/ShieldedPool';
import { PriceChart } from '@/components/apps/PriceChart';
import { About } from '@/components/apps/About';
import { Settings } from '@/components/apps/Settings';
import { Calculator } from '@/components/apps/Calculator';
import { Themes } from '@/components/apps/Themes';
import { Pools } from '@/components/apps/Pools';
import { TotalSupply } from '@/components/apps/TotalSupply';
import { TotalShielded } from '@/components/apps/TotalShielded';
import { ShieldedPercent } from '@/components/apps/ShieldedPercent';
import { TotalTxs } from '@/components/apps/TotalTxs';
import { ShieldedChart } from '@/components/apps/ShieldedChart';
import { PoolsChart } from '@/components/apps/PoolsChart';
import { SupplyChart } from '@/components/apps/SupplyUsdChart';
import { Readme } from '@/components/apps/Readme';
import {
  StatsFolderContents,
  ChartsFolderContents,
  ToolsFolderContents,
  GamesFolderContents,
  PrivacyFolderContents,
  RingsFolderContents,
  EducationFolderContents,
  MediaFolderContents,
  WidgetsFolderContents,
  SystemFolderContents,
} from '@/components/apps/FolderContents';

// Lazy-loaded components (games, terminal, explorer, privacy, widgets - only load when opened)
const Terminal = dynamic(() => import('@/components/apps/Terminal'), { ssr: false });
const Shmup = dynamic(() => import('@/components/apps/games/Shmup'), { ssr: false });
const Zeometry = dynamic(() => import('@/components/apps/games/zeometry/Zeometry'), { ssr: false });
const Zkyline = dynamic(() => import('@/components/apps/games/zkyline/Zkyline'), { ssr: false });
const Zecamp = dynamic(() => import('@/components/apps/media/Zecamp'), { ssr: false });
const Milkdrop = dynamic(() => import('@/components/apps/media/Milkdrop'), { ssr: false });
const SystemTutorial = dynamic(() => import('@/components/apps/SystemTutorial'), { ssr: false });
const Zim = dynamic(() => import('@/components/apps/zim/Zim'), { ssr: false });
const ZimChat = dynamic(() => import('@/components/apps/zim/ZimChat'), { ssr: false });
const Pong = dynamic(() => import('@/components/apps/games/Pong'), { ssr: false });
const Zendro = dynamic(() => import('@/components/apps/zendro/Zendro'), { ssr: false });
const Zendrospiracies = dynamic(() => import('@/components/apps/zendro/Zendrospiracies'), { ssr: false });
const SystemDebugger = dynamic(() => import('@/components/apps/SystemDebugger'), { ssr: false });
const Moderation = dynamic(() => import('@/components/apps/Moderation'), { ssr: false });
const Explorer = dynamic(() => import('@/components/apps/Explorer'), { ssr: false });
const BlockMap = dynamic(() => import('@/components/apps/BlockMap'), { ssr: false });
const ChainPulse = dynamic(() => import('@/components/apps/ChainPulse'), { ssr: false });
const PrivacyWeather = dynamic(() => import('@/components/apps/privacy/PrivacyWeather'), { ssr: false });
const PrivacyCoach = dynamic(() => import('@/components/apps/privacy/PrivacyCoach'), { ssr: false });
const PrivacyFlowChart = dynamic(() => import('@/components/apps/privacy/PrivacyFlowChart'), { ssr: false });
const NetworkData = dynamic(() => import('@/components/apps/widgets/NetworkData'), { ssr: false });
const ChartsDashboard = dynamic(() => import('@/components/apps/widgets/ChartsDashboard'), { ssr: false });
const Mining = dynamic(() => import('@/components/apps/Mining'), { ssr: false });
const UaDecoder = dynamic(() => import('@/components/apps/tools/UaDecoder'), { ssr: false });
const ExchangeChecker = dynamic(() => import('@/components/apps/tools/ExchangeChecker'), { ssr: false });
const PayMe = dynamic(() => import('@/components/apps/tools/PayMe'), { ssr: false });
const ZcashStatus = dynamic(() => import('@/components/apps/tools/ZcashStatus'), { ssr: false });
const Feedback = dynamic(() => import('@/components/apps/Feedback'), { ssr: false });
const Account = dynamic(() => import('@/components/apps/tools/Account'), { ssr: false });
const Watchlist = dynamic(() => import('@/components/apps/Watchlist'), { ssr: false });
const HalvingWidget = dynamic(() => import('@/components/apps/widgets/HalvingWidget'), { ssr: false });
const BlockComparison = dynamic(() => import('@/components/apps/BlockComparison'), { ssr: false });
const TxGraph = dynamic(() => import('@/components/apps/TxGraph'), { ssr: false });
const Mempool = dynamic(() => import('@/components/apps/Mempool'), { ssr: false });
const Slipstream = dynamic(() => import('@/components/apps/Slipstream'), { ssr: false });
// Canvas/WebGL inside, same as Pools, so it must not render on the server.
const Hindsight = dynamic(() => import('@/components/apps/Hindsight'), { ssr: false });
// Live Pools in the picker, so canvas inside - same reason as pools/market.

// id → component. `block-ticker` is intentionally absent: it is a registry
// placeholder rendered separately as the always-on strip.
const COMPONENTS: Record<string, React.ComponentType> = {
  'price-ticker': PriceTicker,
  'block-height': BlockHeight,
  'difficulty': Difficulty,
  'transparent-pool': TransparentPool,
  'shielded-pool': ShieldedPool,
  'shielded-pools': Pools,
  'total-supply': TotalSupply,
  'total-shielded': TotalShielded,
  'shielded-percent': ShieldedPercent,
  'total-txs': TotalTxs,
  'mining': Mining,
  'price-chart': PriceChart,
  'shielded-chart': ShieldedChart,
  'shielded-pools-chart': PoolsChart,
  'supply-chart': SupplyChart,
  'about': About,
  'settings': Settings,
  'system-tutorial': SystemTutorial,
  'zim': Zim,
  'zim-chat': ZimChat,
  'calculator': Calculator,
  'hindsight': Hindsight,
  'themes': Themes,
  'terminal': Terminal,
  'explorer': Explorer,
  'ua-decoder': UaDecoder,
  'exchange-checker': ExchangeChecker,
  'pay-me': PayMe,
  'zcash-status': ZcashStatus,
  'feedback': Feedback,
  'account': Account,
  'watchlist': Watchlist,
  'block-comparison': BlockComparison,
  'privacy-weather': PrivacyWeather,
  'privacy-coach': PrivacyCoach,
  'privacy-flow-chart': PrivacyFlowChart,
  'slipstream': Slipstream,
  'zecamp': Zecamp,
  'milkdrop': Milkdrop,
  'shmup': Shmup,
  'zeometry': Zeometry,
  zkyline: Zkyline,
  'pong': Pong,
  'zendro': Zendro,
  'zendrospiracies': Zendrospiracies,
  'system-debugger': SystemDebugger,
  'moderation': Moderation,
  'block-map': BlockMap,
  'chain-pulse': ChainPulse,
  'tx-graph': TxGraph,
  'mempool': Mempool,
  'readme': Readme,
  'stats-folder': StatsFolderContents,
  'charts-folder': ChartsFolderContents,
  'tools-folder': ToolsFolderContents,
  'games-folder': GamesFolderContents,
  'privacy-folder': PrivacyFolderContents,
  'education-folder': EducationFolderContents,
  'media-folder': MediaFolderContents,
  'widgets-folder': WidgetsFolderContents,
  'system-folder': SystemFolderContents,
  'network-data': NetworkData,
  'charts-dashboard': ChartsDashboard,
  'halving-widget': HalvingWidget,
};

export const APP_REGISTRY: AppConfig[] = APP_META.map((meta) => ({
  ...meta,
  type: meta.id,
  component: COMPONENTS[meta.id] as React.ComponentType,
}));

/** Look up a full app entry (metadata + component) by id. */
export function getApp(id: string): AppConfig | undefined {
  return APP_REGISTRY.find((a) => a.id === id);
}
