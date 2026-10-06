/**
 * The ZEC-OS icon set: golden line marks on the house's dark tile, drawn to
 * sit beside the Pools, Marketplace and Pool Traffic logos - copper at the
 * foot of each stroke warming to gold at the head, a soft glow under every
 * line, and a bright core dot where the eye should land.
 *
 * Each icon is a short list of primitives on a 64-unit grid (content kept
 * within 10..54 so it clears the tile's rounded corners). `ZecIcon` turns
 * them into an inline SVG; the glow layer is derived, never drawn by hand.
 *
 * Keys are app ids (and folder ids), plus a few desktop/menu actions. Apps
 * with a real logo (Pools, Marketplace, Pool Traffic, zecAmp) keep it: see
 * `LOGO_IDS`.
 */

export type Tone = 'gold' | 'amber' | 'copper' | 'ink' | 'pale';
export type Prim =
  /** A stroked path, in the gradient, with its glow. */
  | { k: 'p'; d: string; w: number; o?: number }
  /** A filled path. */
  | { k: 'f'; d: string; tone: Tone; o?: number }
  /** A stroked circle, in the gradient, with its glow. */
  | { k: 'c'; x: number; y: number; r: number; w: number; o?: number }
  /** A filled dot. */
  | { k: 'd'; x: number; y: number; r: number; tone: Tone; o?: number }
  /** A little text, for the marks that are letters. */
  | { k: 't'; s: string; x: number; y: number; size: number; tone: Tone };

export const TONES: Record<Tone, string> = {
  gold: '#f4b728', amber: '#e49e2f', copper: '#c56b3e', ink: '#0d0d12', pale: '#fff1b0',
};

const p = (d: string, w = 4, o?: number): Prim => ({ k: 'p', d, w, o });
const f = (d: string, tone: Tone = 'gold', o?: number): Prim => ({ k: 'f', d, tone, o });
const c = (x: number, y: number, r: number, w = 4, o?: number): Prim => ({ k: 'c', x, y, r, w, o });
const dot = (x: number, y: number, r = 3, tone: Tone = 'gold', o?: number): Prim => ({ k: 'd', x, y, r, tone, o });
const t = (s: string, x: number, y: number, size: number, tone: Tone = 'gold'): Prim => ({ k: 't', s, x, y, size, tone });

/** A gear: `n` teeth between two radii. */
function gear(cx: number, cy: number, rIn: number, rOut: number, n: number): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 4; i++) {
    const a = (i / (n * 4)) * Math.PI * 2 - Math.PI / 2, r = i % 4 < 2 ? rOut : rIn;
    pts.push(`${(cx + Math.cos(a) * r).toFixed(1)} ${(cy + Math.sin(a) * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
}
/** Concentric rings from one origin, spacing widening outward: the Pools motif. */
function ripples(x: number, y: number, rs: number[], w0 = 4.5): Prim[] {
  return rs.map((r, i) => c(x, y, r, Math.max(1.5, w0 - i * 1.1), 1 - i * 0.22));
}

const SHIELD = 'M32 11L48 17V30C48 41 41 48.5 32 53C23 48.5 16 41 16 30V17Z';
const LOCK_BODY = 'M19 30H45V51H19Z';
const WINDOW = 'M10 14H54V50H10Z';

export const ZEC_ICONS: Record<string, Prim[]> = {
  // ── Stats ─────────────────────────────────────────────────────────────
  'price-ticker': [c(32, 32, 19, 4), p('M24 24H40L24 40H40', 4.5), p('M32 18V24M32 40V46', 4), dot(32, 32, 2, 'pale')],
  'block-height': [p('M32 13L48 21L32 29L16 21Z', 3.5), p('M16 21V40L32 48L48 40V21M32 29V48', 3.5), dot(32, 21, 3), p('M53 42V14M49 18L53 13L57 18', 2.5, 0.7)],
  difficulty: [p('M13 44A19 19 0 0 1 51 44', 4), p('M16 36L19 38M22 29L24 31.5M32 25V28.5M42 29L40 31.5M48 36L45 38', 2.5, 0.7), f('M35 20L26 38H32L29 50L40 31H34L37 20Z', 'gold')],
  'transparent-pool': [p(LOCK_BODY, 3.5), p('M25 30V22A8 8 0 0 1 41 20', 4), dot(32, 39, 3), p('M32 42V45', 3), p('M48 16A20 20 0 0 1 54 26', 2.5, 0.5)],
  'shielded-pool': [p(SHIELD, 4), ...ripples(32, 31, [5.5, 11], 3), dot(32, 31, 2.5)],
  'shielded-pools': [c(24.5, 37, 11, 3.5), c(39.5, 37, 11, 3.5), c(32, 24, 11, 3.5), dot(32, 32.5, 3)],
  'total-supply': [p('M17 22A15 5.5 0 1 0 47 22A15 5.5 0 1 0 17 22', 3.5), p('M17 22V43A15 5.5 0 0 0 47 43V22', 3.5), p('M17 29A15 5.5 0 0 0 47 29M17 36A15 5.5 0 0 0 47 36', 2.5, 0.7), dot(32, 22, 2.5)],
  'total-shielded': [p(SHIELD, 2.5, 0.35), p('M22 32H42V48H22Z', 3.5), p('M26 32V27A6 6 0 0 1 38 27V32', 3.5), dot(32, 40, 2.8)],
  'shielded-percent': [c(32, 32, 17, 3, 0.3), p('M32 15A17 17 0 1 1 15.8 37.3', 4.5), dot(15.8, 37.3, 3), t('%', 32, 38, 15, 'gold')],
  'total-txs': [p('M20 11H44V53L40 50L36 53L32 50L28 53L24 50L20 53Z', 3.5), p('M26 21H38M26 28H38M26 35H33', 3), dot(38, 42, 2.5)],
  mining: [p('M13 25Q29 9 47 19', 5), p('M29 16L41 49', 4.5), p('M12 40H26V53H12Z', 3, 0.8), dot(47, 19, 3)],
  // ── Charts ────────────────────────────────────────────────────────────
  'price-chart': [p('M13 13V51H51', 2.5, 0.45), p('M18 43L27 33L34 38L47 20', 4.5), dot(47, 20, 3.5), dot(18, 43, 2.5, 'copper')],
  'shielded-chart': [f('M13 45L24 36L33 39L51 22V51H13Z', 'amber', 0.16), p('M13 45L24 36L33 39L51 22', 4), p('M20 11L27 14V19C27 23 24 25.5 20 27C16 25.5 13 23 13 19V14Z', 2.5), dot(51, 22, 3)],
  'shielded-pools-chart': [p('M10 24Q17 17 24 24T38 24T52 24', 4), p('M10 34Q17 27 24 34T38 34T52 34', 3.2, 0.7), p('M10 44Q17 37 24 44T38 44T52 44', 2.5, 0.45)],
  'supply-chart': [p('M13 13V51H51', 2.5, 0.45), p('M17 48V38H27V29H36V23H44V20H51', 4), p('M17 17H51', 2, 0.35), dot(51, 20, 3)],
  // ── System ────────────────────────────────────────────────────────────
  about: [c(32, 32, 19, 4), dot(32, 22.5, 3.2), p('M32 30V43', 5)],
  zim: [p('M25 18H45L28 46H47', 5), p('M11 25H20M9 33H19M13 41H22', 3, 0.6), dot(45, 18, 3)],
  'zim-chat': [p('M13 15H51V40H30L21 49V40H13Z', 3.5), dot(23, 27.5, 2.8), dot(32, 27.5, 2.8, 'amber'), dot(41, 27.5, 2.8, 'copper')],
  'system-tutorial': [c(32, 32, 19, 3.5), p('M32 9V13M32 51V55M9 32H13M51 32H55', 2.5, 0.6), f('M32 16L37 32H27Z', 'gold'), f('M32 48L37 32H27Z', 'copper'), dot(32, 32, 2.2, 'ink')],
  settings: [p(gear(32, 32, 14, 19, 8), 3.5), c(32, 32, 6, 3.5), dot(32, 32, 2)],
  hindsight: [c(34, 34, 15, 3.5), p('M34 25V34L40 38', 3.5), p('M13 29A21 21 0 0 1 27 14', 3), p('M21 12L28 14L26 21', 3), dot(34, 34, 2.2)],
  calculator: [p('M18 10H46V54H18Z', 3.5), p('M23 16H41V24H23Z', 2.5), ...[25, 32, 39].flatMap((x, i) => [32, 40, 48].map((y, j) => dot(x, y, 2.4, (i + j) % 3 === 0 ? 'gold' : (i + j) % 3 === 1 ? 'amber' : 'copper')))],
  screensavers: [p('M11 13H53V42H11Z', 3.5), p('M26 51H38M32 42V51', 3.5), p('M16 30Q21 22 26 30T36 30T46 30', 3), dot(46, 30, 2.5)],
  themes: [p('M32 12C20 12 12 20 12 31C12 42 20 51 30 51C34 51 34 47 32 44C30 41 32 38 36 38H42C48 38 52 34 52 28C52 19 43 12 32 12Z', 3.5), dot(22, 27, 3.5, 'gold'), dot(30, 19.5, 3.5, 'amber'), dot(41, 21, 3.5, 'copper'), dot(21, 38, 3, 'pale')],
  terminal: [p(WINDOW, 3.5), p('M10 21H54', 2, 0.6), p('M18 29L25 35.5L18 42', 4), p('M30 42H41', 4), dot(15, 17.5, 1.5, 'copper')],
  explorer: [c(28, 28, 14, 4.5), p('M38.5 38.5L50 50', 6.5), p('M22 23H34V33H22Z', 2.5, 0.8), dot(28, 28, 2)],
  'ua-decoder': [p('M20 14H13V50H20M44 14H51V50H44', 4), t('u1', 32, 39, 18, 'gold')],
  // a bank front with a check mark on the step
  'exchange-checker': [p('M11 24L32 12L53 24Z', 3.5), p('M17 29V43M27 29V43M37 29V43M47 29V43', 3), p('M10 49H54', 3.5), dot(32, 19.5, 2)],
  // a radar sweep with three route blips
  'swap-radar': [c(32, 32, 20, 3.5), c(32, 32, 12, 2.5, 0.6), c(32, 32, 4, 2, 0.5), p('M32 32L46 18', 3.5), dot(44, 37, 2.6, 'gold'), dot(23, 22, 2.2, 'amber'), dot(21, 42, 2, 'copper')],
  // a folded map with a pin
  'spend-map': [p('M10 18L24 12L40 18L54 12V46L40 52L24 46L10 52Z', 3.5), p('M24 12V46M40 18V52', 2.2, 0.6), p('M40 22C35 22 33 26 33 28.5C33 33 40 39 40 39C40 39 47 33 47 28.5C47 26 45 22 40 22Z', 3), dot(40, 28.5, 2.2, 'gold')],
  // a coin with a z, held out on a palm
  // A honeycomb cell with a bee in it: Zeni's hive, pooling nectar.
  buzz: [p('M32 8L52 20V44L32 56L12 44V20Z', 3.5), f('M26 32A6 8 0 1 0 38 32A6 8 0 1 0 26 32Z', 'gold'), p('M26.5 30H37.5M26.5 35H37.5', 2, 0.9), p('M30 25C27 19 21 19 20 23C19 27 25 28 30 27M34 25C37 19 43 19 44 23C45 27 39 28 34 27', 2.5, 0.8)],
  'pay-me': [c(32, 26, 13, 3.5), t('Z', 32, 31.5, 15, 'gold'), p('M10 46C18 46 22 42 30 42H40C43 42 43 46 40 46H31M10 52H38L52 42C54 40 51 37 48 39L40 44', 3)],
  // a lifebuoy: ring, inner ring, four bands
  'rescue-kit': [c(32, 32, 19, 4), c(32, 32, 8.5, 3.5), p('M18.5 18.5L26 26M45.5 18.5L38 26M18.5 45.5L26 38M45.5 45.5L38 38', 4), dot(32, 32, 1.8, 'pale')],
  // a traffic light
  'zcash-status': [p('M23 9H41V55H23Z', 3.5), c(32, 19, 4.5, 3), c(32, 32, 4.5, 3, 0.7), c(32, 45, 4.5, 3, 0.5), dot(32, 19, 2.6, 'gold'), dot(32, 32, 2.2, 'amber'), dot(32, 45, 2.2, 'copper')],
  account: [c(32, 23, 8.5, 4), p('M15 51C15 41 22 35.5 32 35.5C42 35.5 49 41 49 51', 4), dot(32, 23, 2)],
  swap: [p('M15 24H46L38 16', 4.5), p('M49 40H18L26 48', 4.5), dot(15, 24, 3, 'copper'), dot(49, 40, 3)],
  watchlist: [p('M9 32Q32 11 55 32Q32 53 9 32Z', 3.5), c(32, 32, 7.5, 3.5), dot(32, 32, 3)],
  'block-comparison': [p('M32 13V50M23 51H41M14 19H50', 3.5), p('M14 19L9 34M14 19L19 34M50 19L45 34M50 19L55 34', 2.2, 0.7), p('M8 34H20Q14 42 8 34ZM44 34H56Q50 42 44 34Z', 3), dot(32, 13, 3)],
  'privacy-weather': [c(25, 25, 8, 3.5), p('M25 11V14M11 25H14M15 15L17.2 17.2M35 15L32.8 17.2', 3, 0.8), p('M22 47H46A7 7 0 0 0 44.5 33.2A10 10 0 0 0 26 36.5A5.3 5.3 0 0 0 22 47Z', 3.5)],
  'privacy-coach': [p(SHIELD, 4), p('M24.5 31.5L30 37L40.5 25.5', 4.5)],
  'privacy-flow-chart': [p('M11 18C29 18 30 29 51 27', 4), p('M11 32H51', 3, 0.7), p('M11 46C29 46 30 35 51 37', 4), dot(51, 27, 2.8), dot(51, 37, 2.8, 'amber'), dot(11, 18, 2.4, 'copper'), dot(11, 46, 2.4, 'copper')],
  slipstream: [p('M32 32m0 -3a3 3 0 1 1 -3 3a6 6 0 0 1 6 -6a9 9 0 0 1 9 9a12 12 0 0 1 -12 12a15 15 0 0 1 -15 -15a18 18 0 0 1 18 -18', 3.5), dot(32, 29, 2.2)],
  zecronomicon: [p('M32 18C26 14 18 14 11 16V48C18 46 26 46 32 50C38 46 46 46 53 48V16C46 14 38 14 32 18Z', 3.5), p('M32 18V50', 2.5), ...ripples(42.5, 31, [3.5, 7], 2.5), dot(42.5, 31, 1.8), p('M17 25H26M17 31H26M17 37H24', 2, 0.6)],
  scriptorium: [p('M49 11C35 13 23 27 21 43L25 39C35 37 45 25 49 11Z', 3.5), p('M13 53L31 31', 3.5), p('M25 39L35 29', 2, 0.6), dot(13, 53, 2.5, 'copper')],
  // Bars rising behind a trend line, its newest point bright.
  metrics: [p('M12 13V51H53', 2.6, 0.7), p('M20 51V40M29 51V33M38 51V37M47 51V25', 4.2, 0.45), p('M18 37L27 29L36 33L47 19', 3.4), dot(47, 19, 3.2, 'pale')],
  // A shield with a gavel line.
  moderation: [p('M32 9L51 16V31C51 43 43 51 32 55C21 51 13 43 13 31V16Z', 3.5), p('M24 32L30 38L41 26', 4)],
  // A monitor with a heartbeat trace.
  'system-debugger': [p('M10 13H54V43H10Z', 3.5), p('M14 30H23L27 21L33 38L37 28H50', 3.2), p('M24 51H40M32 43V51', 3.5), dot(50, 28, 2.6, 'pale')],
  users: [c(41, 21, 6.5, 3, 0.65), p('M31 43C31 35 35 31 41 31C47 31 53 35 53 43', 3, 0.65), c(25, 25, 7.5, 4), p('M11 51C11 42 17 37 25 37C33 37 39 42 39 51', 4)],
  'swap-admin': [c(32, 32, 6, 3.5), p('M11 25H22V39H11ZM42 25H53V39H42Z', 3), p('M22 32H26M38 32H42', 3), p('M26.5 17A8 8 0 0 1 37.5 17M22 12.5A14 14 0 0 1 42 12.5', 2.5, 0.7), dot(32, 32, 2.2)],
  'tournament-admin': [p('M22 13H42V25C42 33 37.5 37.5 32 37.5C26.5 37.5 22 33 22 25Z', 3.5), p('M22 17H15C15 25 18.5 27.5 22 27.5M42 17H49C49 25 45.5 27.5 42 27.5', 3), p('M32 37.5V45M23 51H41', 4), f('M32 18.5L33.8 22.4L38 22.8L34.9 25.6L35.8 29.8L32 27.6L28.2 29.8L29.1 25.6L26 22.8L30.2 22.4Z', 'gold')],
  'help-videos': [p('M11 15H53V49H11Z', 3.5), p('M11 21H53M11 43H53', 2, 0.55), f('M27 25L40 32L27 39Z', 'gold')],
  // a ship banking through a grid that bends around a gravity well, a note and some dust
  // A skyline, and a runner mid double jump over the gap.
  zkyline: [p('M6 54V38H14V30H22V44H28M40 54V34H48V24H56V54', 3), p('M6 54H28M40 54H58', 2.5, 0.5), c(33, 15, 3, 2.5), p('M33 19V27M33 27L29 33M33 27L37 31M33 22L28 24M33 22L38 20', 2.5), p('M20 22H25M18 26H24', 2, 0.5)],
  zeometry: [p('M10 22Q32 30 54 22M10 42Q32 34 54 42M22 10Q30 32 22 54M42 10Q34 32 42 54', 1.6, 0.45), c(32, 32, 5, 2.5, 0.8),
    p('M20 47L33 33L28 46L42 40Z', 3.5), p('M44 17L49 21L44 25L39 21Z', 2.5, 0.85), dot(15, 19, 2.4, 'pale'), dot(51, 47, 1.8, 'amber')],
  shmup: [p('M32 11L43 41L32 35L21 41Z', 3.5), f('M29 44L32 53L35 44Z', 'amber'), p('M15 22V27M49 22V27', 2.5, 0.5), dot(32, 25, 2.5)],
  // Down the hollow trunk: growth rings receding to a bright core, a dendrite leafing out of the wall.
  zendro: [c(27, 32, 16, 3), c(27, 32, 13.6, 1, 0.35), c(29, 30.4, 10, 2.4, 0.85), c(30.4, 29.3, 5.8, 2, 0.7), c(31.3, 28.6, 2.4, 1.6, 0.6), p('M16.6 20.6L24.4 25.4M14.6 40.4L23 35.6M33.4 46.6L31.8 38.6', 1.2, 0.45), p('M38.7 20.6C41.5 17.5 44.5 15 48.5 13', 2.6), f('M47.3 13.6C48.3 10.4 51.6 9.4 53.6 10.4C53 13.4 50.2 15 47.3 13.6Z', 'gold'), f('M42.6 17.4C40.4 15.4 40.6 12.4 42.4 11C44.4 12.8 44.6 15.6 42.6 17.4Z', 'amber'), dot(31.6, 28.5, 1.5, 'pale')],
  // An eye in a pyramid, set in the trunk's rings.
  zendrospiracies: [c(32, 33, 22, 2, 0.3), c(32, 33, 17.5, 1.4, 0.5), p('M32 12L52 47H12Z', 3.4), p('M21.5 37C25.5 31.5 38.5 31.5 42.5 37C38.5 42.5 25.5 42.5 21.5 37Z', 2.4), dot(32, 37, 3.2, 'pale'), p('M32 5V9M17 9.5L19 13M47 9.5L45 13', 1.8, 0.6)],
  // DOOM's splash lettering, in gold: the outer letters taller, copper extrusion beneath.
  zoom: [f('M8.3 17.2 H20.3 V23.2 L14.5 43.2 H20.3 V49.2 H8.3 V43.2 L14.1 23.2 H8.3 Z', 'copper'), f('M21.8 24.2 L24.8 21.2 H29.3 L32.3 24.2 V43.2 L29.3 46.2 H24.8 L21.8 43.2 Z', 'copper'), f('M34.3 24.2 L37.3 21.2 H41.8 L44.8 24.2 V43.2 L41.8 46.2 H37.3 L34.3 43.2 Z', 'copper'), f('M46.3 17.2 H50.6 L52.3 24.2 L54 17.2 H58.3 V49.2 H54.7 V30.2 L52.3 36.2 L49.9 30.2 V49.2 H46.3 Z', 'copper'), f('M7 15H19V21L13.2 41H19V47H7V41L12.8 21H7Z', 'gold'), f('M20.5 22L23.5 19H28L31 22V41L28 44H23.5L20.5 41Z', 'gold'), f('M33 22L36 19H40.5L43.5 22V41L40.5 44H36L33 41Z', 'gold'), f('M45 15H49.3L51 22L52.7 15H57V47H53.4V28L51 34L48.6 28V47H45Z', 'gold'), f('M24 24V39H27.5V24Z', 'ink'), f('M36.5 24V39H40V24Z', 'ink'), p('M7 15H19V21L13.2 41H19V47H7V41L12.8 21H7Z', 1.3, 0.9), p('M20.5 22L23.5 19H28L31 22V41L28 44H23.5L20.5 41Z', 1.3, 0.9), p('M33 22L36 19H40.5L43.5 22V41L40.5 44H36L33 41Z', 1.3, 0.9), p('M45 15H49.3L51 22L52.7 15H57V47H53.4V28L51 34L48.6 28V47H45Z', 1.3, 0.9), p('M8 16.5H18M21.5 21.5L23.8 20.2H27.7M34 21.5L36.3 20.2H40.2M46 16.5H48.6M53.6 16.5H56', 1, 0.0)],
  pong: [p('M14 19V35', 5.5), p('M50 29V45', 5.5), p('M19 41L31 29', 2.5, 0.4), dot(35, 25, 4)],
  'bbs-rpg': [p('M14 14L45 45M50 14L19 45', 4), p('M37 49L49 37M15 37L27 49', 4), dot(49, 49, 3), dot(15, 49, 3, 'copper')],
  'block-map': [p('M12 12H26V26H12ZM30 12H44V26H30ZM12 30H26V44H12ZM30 30H44V44H30Z', 2.5, 0.75), f('M30 30H44V44H30Z', 'gold', 0.9), p('M48 12V52M12 48H52', 2, 0.35)],
  'chain-pulse': [c(32, 32, 20, 2, 0.3), p('M9 33H21L25.5 22L32 45L36.5 29L40 33H55', 4), dot(55, 33, 2.5)],
  'tx-graph': [p('M18 20L32 34L46 18M32 34L16 46M32 34L48 46M18 20L16 46', 2.5, 0.75), dot(32, 34, 4.2), dot(18, 20, 3, 'amber'), dot(46, 18, 3), dot(16, 46, 3, 'copper'), dot(48, 46, 3, 'amber')],
  mempool: [p('M20 11H44M20 53H44', 4), p('M22 11C22 24 30 28 32 32C34 36 42 40 42 53M42 11C42 24 34 28 32 32C30 36 22 40 22 53', 3.5), f('M26 49L32 43L38 49Z', 'gold'), dot(32, 31, 2)],
  'halving-widget': [c(32, 32, 18, 3.5), f('M32 14A18 18 0 0 1 32 50Z', 'gold', 0.85), p('M32 10V54', 2, 0.5)],
  readme: [p('M18 10H38L46 18V54H18Z', 3.5), p('M38 10V18H46', 3), p('M24 28H40M24 35H40M24 42H34', 3), dot(24, 21, 2)],
  'darkforest-manual': [p('M22 12H46V44', 3.5), p('M22 12A4 4 0 0 0 18 16V48A4 4 0 0 0 22 52H44A4 4 0 0 0 48 48V44H26V48A4 4 0 0 1 22 52', 3.5), p('M28 20L32 14L36 20M29 26L32 20L35 26', 2.5, 0.8), p('M28 34H40M28 39H36', 2.2, 0.6)],
  registry: [p('M13 16H51V29H13ZM13 34H51V47H13Z', 3.5), p('M28 22.5H36M28 40.5H36', 3), dot(46, 22.5, 2, 'amber'), dot(46, 40.5, 2, 'copper')],
  feedback: [p('M13 31A9.5 9.5 0 0 1 32 31V48H13Z', 3.5), p('M22.5 21.5H44A8 8 0 0 1 52 29.5V48H32', 3.5), p('M42 38V27H48', 3), p('M28 48V55', 3, 0.6)],
  'network-data': [p('M32 30V52M24 52H40', 3.5), dot(32, 27, 3.5), p('M24 19A11 11 0 0 1 40 19M19 13A18 18 0 0 1 45 13', 3, 0.8), p('M24 35A11 11 0 0 0 40 35', 3, 0.5)],
  'charts-dashboard': [p('M11 11H30V30H11ZM34 11H53V22H34ZM34 26H53V53H34ZM11 34H30V53H11Z', 2.8), p('M15 25L20 20L25 23', 2.5), p('M38 47V40M43 47V35M48 47V43', 3), dot(20.5, 43.5, 4.5, 'amber')],
  'block-ticker': [p('M9 19H55V45H9Z', 3.5), p('M15 32H20M24 32H31M35 32H40M44 32H49', 4), dot(12.5, 32, 1.5, 'copper'), p('M26 51H38', 3, 0.6)],
  // ── Folders ───────────────────────────────────────────────────────────
  'stats-folder': [p('M12 52H52', 2.5, 0.45), p('M18 47V34M28 47V24M38 47V30M48 47V16', 6.5), dot(48, 16, 3.2, 'pale')],
  'charts-folder': [p('M12 44L22 33L31 38L41 24L52 18', 4.5), p('M12 52H52', 2.5, 0.45), dot(22, 33, 3, 'amber'), dot(41, 24, 3), dot(52, 18, 3, 'pale')],
  'tools-folder': [p('M40.5 13.5A10 10 0 0 0 36 29L16 49A3.5 3.5 0 0 0 21 54L41 34A10 10 0 0 0 51 21L45 27L39 25L37 19Z', 3.5), dot(18.5, 51.5, 1.8, 'copper')],
  'games-folder': [p('M20 22H44C50 22 54 28 54 36C54 44 50 48 46 48C42 48 40 42 36 42H28C24 42 22 48 18 48C14 48 10 44 10 36C10 28 14 22 20 22Z', 3.5), p('M20 30V38M16 34H24', 3), dot(42, 31, 2.6), dot(47, 36, 2.6, 'copper')],
  'privacy-folder': [p(LOCK_BODY, 3.5), p('M24.5 30V23A7.5 7.5 0 0 1 39.5 23V30', 4), c(32, 40.5, 3.5, 3)],
  'rings-folder': [...ripples(27, 38, [6, 13, 21], 4.5), c(27, 38, 29, 1.5, 0.2), dot(27, 38, 3.5)],
  'education-folder': [p('M32 13L55 23L32 33L9 23Z', 3.5), p('M18 27V38C18 42 25 46 32 46C39 46 46 42 46 38V27', 3.5), p('M53 24V38', 2.5), dot(53, 40, 2.5)],
  'media-folder': [p('M26 44V16L48 11V39', 3.5), c(20, 44, 6, 3.5), c(42, 39, 6, 3.5), p('M26 22L48 17', 3, 0.7)],
  // A monitor on its stand, a small cog on screen: the OS's own settings and pieces.
  'system-folder': [p('M10 13H54V41H10Z', 3.5), p('M26 51H38M32 41V51', 3), c(32, 27, 5, 3), p('M32 18V20.5M32 33.5V36M23 27H25.5M38.5 27H41', 3, 0.8), dot(48, 18, 1.8, 'copper')],
  'widgets-folder': [p('M11 11H29V29H11ZM35 11H53V29H35ZM11 35H29V53H11Z', 3), p('M44 35V53M35 44H53', 4), dot(44, 44, 3, 'pale')],
  // ── Desktop and menu actions ──────────────────────────────────────────
  'show-desktop': [p('M11 13H53V39H11Z', 3, 0.55), p('M32 21V45M24 37L32 45L40 37', 4.5), p('M13 51H51', 3.5)],
  'stack-windows': [p('M10 12H38V32H10Z', 2.5, 0.45), p('M17 20H45V40H17Z', 2.8, 0.7), p('M24 28H52V50H24Z', 3.5), dot(28, 32, 1.8, 'copper')],
  'close-all': [c(32, 32, 19, 3, 0.4), p('M23 23L41 41M41 23L23 41', 5)],
  'toggle-icons': [p('M11 13H53V43H11Z', 3.5), p('M26 51H38M32 43V51', 3), p('M18 20H24V26H18ZM18 31H24V37H18Z', 2.5), dot(40, 28, 3)],
  folder: [p('M10 18H26L30 23H54V49H10Z', 3.5), p('M10 28H54', 2, 0.5)],
  // ── Tray ──────────────────────────────────────────────────────────────
  coffee: [p('M15 27H41V39C41 46 36 50 28 50C20 50 15 46 15 39Z', 3.5), p('M41 30H45A5.5 5.5 0 0 1 45 41H41', 3.2), p('M22 11Q19 15 22 19M29 9Q26 13 29 17M36 11Q33 15 36 19', 2.5, 0.6), p('M12 54H44', 3, 0.7), dot(28, 38, 2.5)],
  bell: [p('M19 42V30A13 13 0 0 1 45 30V42L49 46H15Z', 3.5), dot(32, 51, 3.2), dot(32, 14.5, 2.4, 'amber'), p('M51 17A12 12 0 0 1 54 26M13 17A12 12 0 0 0 10 26', 2.5, 0.5)],
  'sound-on': [p('M12 26H21L32 16V48L21 38H12Z', 3.5), p('M39 25A9 9 0 0 1 39 39M44 19A17 17 0 0 1 44 45', 3.2)],
  'sound-low': [p('M12 26H21L32 16V48L21 38H12Z', 3.5), p('M39 25A9 9 0 0 1 39 39', 3.2)],
  'sound-off': [p('M12 26H21L32 16V48L21 38H12Z', 3.5), p('M40 26L52 38M52 26L40 38', 3.5)],
  'net-ok': [p('M14 50V42M24 50V34M34 50V26M44 50V18', 5.5), dot(44, 14, 2.6, 'pale')],
  'net-down': [p('M14 50V42M24 50V34', 5.5), p('M34 50V26M44 50V18', 5.5, 0.25), p('M38 12L52 26M52 12L38 26', 3.5)],
};

/** Apps whose own logo stays: these are the originals the set is drawn to match. */
export const LOGO_IDS = new Set(['pools', 'market', 'pool-traffic', 'zecamp']);

/** Where a call site only has a glyph: the drawing it stands for. */
export const GLYPH_ICONS: Record<string, string> = {
  '📊': 'stats-folder', '📈': 'charts-folder', '🔧': 'tools-folder', '🎮': 'games-folder', '🔒': 'privacy-folder',
  '◎': 'rings-folder', '📖': 'education-folder', '🎵': 'media-folder', '🧩': 'widgets-folder', '💾': 'system-folder',
  'ℹ️': 'about', '📄': 'readme', '📜': 'darkforest-manual', '🧭': 'system-tutorial', '💻': 'terminal', '⚔️': 'bbs-rpg',
  '🔍': 'explorer', '🗂️': 'registry', '💸': 'hindsight', '🏆': 'tournament-admin', '⚙️': 'settings',
  '⬇️': 'show-desktop', '✖️': 'close-all', '🖥️': 'toggle-icons', '📁': 'folder',
  '☕': 'coffee', '🔔': 'bell', '📮': 'feedback', '🔊': 'sound-on', '🔉': 'sound-low', '🔇': 'sound-off', '📶': 'net-ok', '📵': 'net-down',
};
