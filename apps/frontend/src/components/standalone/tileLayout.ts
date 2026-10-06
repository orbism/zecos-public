export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Minimum usable pane height before the container starts scrolling instead of shrinking. */
export const MIN_PANE_HEIGHT = 380;

/** How far a single pane may be dragged from an even share, in either direction. */
export const MIN_WEIGHT = 0.45;
export const MAX_WEIGHT = 2.2;

/**
 * User resize weights. `rows[r]` scales row r's height; `cols[r][c]` scales the
 * width of column c within row r. Missing entries default to 1 (an even share).
 */
export interface TileWeights {
  rows?: number[];
  cols?: number[][];
}

/** A gutter the user can drag to resize. */
export interface Gutter {
  kind: 'col' | 'row';
  /** Row index; for 'col' also the pair of columns it sits between. */
  row: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rows-of-columns description for a given pane count.
 *
 *   1 → full
 *   2 → side by side
 *   3 → two on top, one full-width below
 *   4 → 2x2
 *   5 → three on top, two below
 *   6 → 3x2
 *   7+ → three per row, last row takes the remainder
 */
export function rowsFor(count: number): number[] {
  switch (count) {
    case 0: return [];
    case 1: return [1];
    case 2: return [2];
    case 3: return [2, 1];
    case 4: return [2, 2];
    case 5: return [3, 2];
    case 6: return [3, 3];
    default: {
      const rows: number[] = [];
      let left = count;
      while (left > 0) {
        rows.push(Math.min(3, left));
        left -= 3;
      }
      return rows;
    }
  }
}

function weightsOf(n: number, given: number[] | undefined): number[] {
  const w = Array.from({ length: n }, (_, i) => {
    const v = given?.[i];
    return Number.isFinite(v) && (v as number) > 0 ? (v as number) : 1;
  });
  // Normalise so the shares always sum to n (i.e. average 1).
  const sum = w.reduce((a, b) => a + b, 0);
  return sum > 0 ? w.map((v) => (v * n) / sum) : w;
}

/**
 * Lay `count` panes out inside a `width` x `height` box.
 *
 * Returns absolute rects (not CSS grid) because grid placement changes cannot be
 * animated - absolute rects let each pane transition its own transform/size,
 * which is what produces the slide when a pane opens or is dragged.
 *
 * `contentHeight` is the full scrollable height; it exceeds `height` once rows
 * would be squeezed below MIN_PANE_HEIGHT.
 */
export function tileLayout(
  count: number,
  width: number,
  height: number,
  gap = 8,
  weights?: TileWeights
): { rects: Rect[]; contentHeight: number; gutters: Gutter[] } {
  const rows = rowsFor(count);
  if (rows.length === 0) return { rects: [], contentHeight: height, gutters: [] };

  const availH = height - gap * (rows.length + 1);
  const rowW = weightsOf(rows.length, weights?.rows);

  const rects: Rect[] = [];
  const gutters: Gutter[] = [];
  let y = gap;

  rows.forEach((cols, r) => {
    const naturalRowH = availH / rows.length;
    const rowH = Math.max(naturalRowH * rowW[r], MIN_PANE_HEIGHT);

    const availW = width - gap * (cols + 1);
    const colW = weightsOf(cols, weights?.cols?.[r]);
    let x = gap;

    for (let c = 0; c < cols; c++) {
      const w = (availW / cols) * colW[c];
      rects.push({ x, y, width: w, height: rowH });
      if (c < cols - 1) {
        gutters.push({
          kind: 'col', row: r, index: c,
          x: x + w, y, width: gap, height: rowH,
        });
      }
      x += w + gap;
    }

    y += rowH;
    if (r < rows.length - 1) {
      gutters.push({ kind: 'row', row: r, index: r, x: gap, y, width: width - gap * 2, height: gap });
    }
    y += gap;
  });

  return { rects, contentHeight: y, gutters };
}
