import { Board, DIRS } from '../engine/board';
import { Color, PieceType, Square, fileOf, rankOf } from '../engine/types';

export const VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

/** Small bonus for central squares (0 at the rim, ~10 in the middle). */
export function centerBonus(s: Square): number {
  const df = Math.abs(fileOf(s) - 3.5);
  const dr = Math.abs(rankOf(s) - 3.5);
  return (3.5 - Math.max(df, dr)) * 3.5;
}

/** Positional value of `type` of `color` standing on `s`. */
export function positional(type: PieceType, color: Color, s: Square): number {
  const rank = rankOf(s);
  const progress = color === 'w' ? rank : 7 - rank; // 0..7 from own back rank
  switch (type) {
    case 'p':
      return progress * 7 + centerBonus(s) * 0.6;
    case 'k':
      return -centerBonus(s) * 1.5; // keep the king tucked away
    case 'n':
    case 'b':
      return centerBonus(s) * 1.4 + (progress === 0 ? -8 : 0); // develop off the back rank
    case 'q':
      return centerBonus(s) * 0.5;
    default:
      return centerBonus(s) * 0.4;
  }
}

/** Value of the cheapest piece of colour `by` attacking `s`, or Infinity if none. */
export function leastAttacker(board: Board, s: Square, by: Color): number {
  const f = fileOf(s);
  const r = rankOf(s);
  let best = Infinity;
  const at = (ff: number, rr: number) => (ff < 0 || ff > 7 || rr < 0 || rr > 7 ? null : board.squares[rr * 8 + ff]);

  const pr = r - (by === 'w' ? 1 : -1);
  for (const df of [-1, 1]) {
    const p = at(f + df, pr);
    if (p && p.color === by && p.type === 'p') best = Math.min(best, VALUE.p);
  }
  for (const [df, dr] of DIRS.KNIGHT) {
    const p = at(f + df, r + dr);
    if (p && p.color === by && p.type === 'n') best = Math.min(best, VALUE.n);
  }
  for (const [df, dr] of DIRS.KING) {
    const p = at(f + df, r + dr);
    if (p && p.color === by && p.type === 'k') best = Math.min(best, VALUE.k);
  }
  const slide = (dirs: [number, number][], types: PieceType[]) => {
    for (const [df, dr] of dirs) {
      let ff = f + df;
      let rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const p = board.squares[rr * 8 + ff];
        if (p) {
          if (p.color === by && types.includes(p.type)) best = Math.min(best, VALUE[p.type]);
          break;
        }
        ff += df;
        rr += dr;
      }
    }
  };
  slide(DIRS.ROOK_DIRS, ['r', 'q']);
  slide(DIRS.BISHOP_DIRS, ['b', 'q']);
  return best;
}

/** Material balance from `color`'s point of view (kings excluded). */
export function material(board: Board, color: Color): number {
  let total = 0;
  for (let s = 0; s < 64; s++) {
    const p = board.squares[s];
    if (!p || p.type === 'k') continue;
    total += p.color === color ? VALUE[p.type] : -VALUE[p.type];
  }
  return total;
}
