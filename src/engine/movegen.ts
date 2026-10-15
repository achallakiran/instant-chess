import { Board, DIRS, ci } from './board';
import { Color, Move, Square, WinRule, fileOf, opposite, rankOf, sq } from './types';

export interface Rules {
  winRule: WinRule;
  castling: boolean;
}

/**
 * Pseudo-legal moves for one piece. In king-capture mode these are also the
 * legal moves: there are no check rules and no castling safety conditions.
 */
export function pseudoMovesFrom(board: Board, s: Square, rules: Rules, out: Move[] = []): Move[] {
  const piece = board.squares[s];
  if (!piece) return out;
  const color = piece.color;
  const enemy = opposite(color);
  const f = fileOf(s);
  const r = rankOf(s);
  const id = piece.id;

  const push = (to: Square, flag: Move['flag'] = 'normal', captureId?: number) => {
    const m: Move = { from: s, to, pieceId: id, flag };
    if (captureId !== undefined) m.captureId = captureId;
    out.push(m);
  };

  switch (piece.type) {
    case 'p': {
      const dir = color === 'w' ? 1 : -1;
      const startRank = color === 'w' ? 1 : 6;
      const lastRank = color === 'w' ? 7 : 0;
      const nr = r + dir;
      if (nr < 0 || nr > 7) break;
      // Pushes
      if (!board.squares[sq(f, nr)]) {
        push(sq(f, nr), nr === lastRank ? 'promotion' : 'normal');
        if (r === startRank && !board.squares[sq(f, r + 2 * dir)]) {
          push(sq(f, r + 2 * dir), 'double');
        }
      }
      // Captures and en passant
      for (const df of [-1, 1]) {
        const nf = f + df;
        if (nf < 0 || nf > 7) continue;
        const to = sq(nf, nr);
        const target = board.squares[to];
        if (target && target.color === enemy) {
          push(to, nr === lastRank ? 'promotion' : 'normal', target.id);
        } else if (!target) {
          for (const ep of board.epActive) {
            if (ep.square !== to || ep.pawnColor !== enemy) continue;
            const pawn = board.squares[ep.pawnSquare];
            if (pawn && pawn.id === ep.pawnId && pawn.type === 'p') {
              push(to, 'enPassant', ep.pawnId);
            }
          }
        }
      }
      break;
    }
    case 'n':
    case 'k': {
      const offsets = piece.type === 'n' ? DIRS.KNIGHT : DIRS.KING;
      for (const [df, dr] of offsets) {
        const nf = f + df;
        const nr = r + dr;
        if (nf < 0 || nf > 7 || nr < 0 || nr > 7) continue;
        const to = sq(nf, nr);
        const t = board.squares[to];
        if (!t) push(to);
        else if (t.color === enemy) push(to, 'normal', t.id);
      }
      if (piece.type === 'k' && rules.castling) genCastling(board, s, color, rules, push);
      break;
    }
    default: {
      const dirs =
        piece.type === 'r'
          ? DIRS.ROOK_DIRS
          : piece.type === 'b'
            ? DIRS.BISHOP_DIRS
            : [...DIRS.ROOK_DIRS, ...DIRS.BISHOP_DIRS];
      for (const [df, dr] of dirs) {
        let nf = f + df;
        let nr = r + dr;
        while (nf >= 0 && nf < 8 && nr >= 0 && nr < 8) {
          const to = sq(nf, nr);
          const t = board.squares[to];
          if (!t) push(to);
          else {
            if (t.color === enemy) push(to, 'normal', t.id);
            break;
          }
          nf += df;
          nr += dr;
        }
      }
    }
  }
  return out;
}

function genCastling(
  board: Board,
  s: Square,
  color: Color,
  rules: Rules,
  push: (to: Square, flag: Move['flag']) => void,
): void {
  const king = board.squares[s]!;
  const rank = color === 'w' ? 0 : 7;
  if (king.hasMoved || s !== sq(4, rank)) return;
  const enemy = opposite(color);
  const strict = rules.winRule === 'checkmate';
  if (strict && board.isAttacked(s, enemy)) return;

  const rookAt = (file: number) => {
    const p = board.squares[sq(file, rank)];
    return p && p.type === 'r' && p.color === color && !p.hasMoved ? p : null;
  };
  const empty = (...files: number[]) => files.every((fl) => !board.squares[sq(fl, rank)]);
  const safe = (...files: number[]) => !strict || files.every((fl) => !board.isAttacked(sq(fl, rank), enemy));

  if (rookAt(7) && empty(5, 6) && safe(5, 6)) push(sq(6, rank), 'castleK');
  if (rookAt(0) && empty(1, 2, 3) && safe(2, 3)) push(sq(2, rank), 'castleQ');
}

/**
 * Legal moves for `color`. Pieces whose id is in `exclude` are skipped
 * (used for "each piece moves at most once per turn").
 */
export function legalMoves(board: Board, color: Color, rules: Rules, exclude?: ReadonlySet<number>): Move[] {
  const out: Move[] = [];
  const strict = rules.winRule === 'checkmate';
  const enemy = opposite(color);
  for (let s = 0; s < 64; s++) {
    const p = board.squares[s];
    if (!p || p.color !== color) continue;
    if (exclude && exclude.has(p.id)) continue;
    const pseudo = pseudoMovesFrom(board, s, rules);
    if (!strict) {
      for (const m of pseudo) out.push(m);
      continue;
    }
    for (const m of pseudo) {
      const u = board.apply(m);
      const k = board.kings[ci(color)];
      const ok = k < 0 || !board.isAttacked(k, enemy);
      board.undo(u);
      if (ok) out.push(m);
    }
  }
  return out;
}

/** Does this (already legal) move leave the enemy king attacked? */
export function givesCheck(board: Board, m: Move): boolean {
  const mover = board.squares[m.from]!;
  const color = mover.color;
  const u = board.apply(m);
  const k = board.kings[ci(opposite(color))];
  const res = k >= 0 && board.isAttacked(k, color);
  board.undo(u);
  return res;
}

export function sameMove(a: Move, b: Move): boolean {
  return a.from === b.from && a.to === b.to && a.flag === b.flag;
}
