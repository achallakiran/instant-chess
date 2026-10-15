import { Color, Move, Piece, PieceType, Square, fileOf, rankOf, sq } from './types';

/** An en passant opportunity: `pawnId` double-stepped over `square`. */
export interface EpTarget {
  square: Square;
  pawnSquare: Square;
  pawnId: number;
  pawnColor: Color;
}

export interface Undo {
  move: Move;
  mover: Piece;
  moverHadMoved: boolean;
  captured: Piece | null;
  capturedSquare: Square;
  wasPromotion: boolean;
  rook?: { piece: Piece; from: Square; to: Square; hadMoved: boolean };
  pushedEp: boolean;
}

export const ci = (c: Color) => (c === 'w' ? 0 : 1);

const KNIGHT: [number, number][] = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING: [number, number][] = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const ROOK_DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

export const DIRS = { KNIGHT, KING, ROOK_DIRS, BISHOP_DIRS };

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';

export class Board {
  squares: (Piece | null)[] = new Array(64).fill(null);
  /** King squares, index 0 = white, 1 = black. -1 when the king is off the board. */
  kings: [Square, Square] = [-1, -1];
  /** En passant targets the side to move may use this turn. */
  epActive: EpTarget[] = [];
  /** Double steps made this turn; they become active for the opponent at turn end. */
  epPending: EpTarget[] = [];

  static start(): Board {
    return Board.fromFen(START_FEN).board;
  }

  /**
   * Parse a FEN string. Returns the board and the side to move.
   * Piece ids: white pieces first (0..), then black, each in square order.
   */
  static fromFen(fen: string): { board: Board; turn: Color } {
    const [placement, side = 'w', castling = '-', ep = '-'] = fen.trim().split(/\s+/);
    const b = new Board();
    const rows = placement.split('/');
    if (rows.length !== 8) throw new Error(`Bad FEN placement: ${placement}`);
    const raw: { type: PieceType; color: Color; square: Square }[] = [];
    rows.forEach((row, i) => {
      const rank = 7 - i;
      let file = 0;
      for (const ch of row) {
        if (/[1-8]/.test(ch)) {
          file += parseInt(ch, 10);
        } else {
          const color: Color = ch === ch.toUpperCase() ? 'w' : 'b';
          raw.push({ type: ch.toLowerCase() as PieceType, color, square: sq(file, rank) });
          file++;
        }
      }
    });
    let id = 0;
    for (const color of ['w', 'b'] as Color[]) {
      raw
        .filter((r) => r.color === color)
        .sort((a, c) => a.square - c.square)
        .forEach((r) => {
          b.squares[r.square] = { type: r.type, color, id: id++, hasMoved: false };
          if (r.type === 'k') b.kings[ci(color)] = r.square;
        });
    }
    // Castling rights -> hasMoved flags.
    for (const color of ['w', 'b'] as Color[]) {
      const rank = color === 'w' ? 0 : 7;
      const kSide = castling.includes(color === 'w' ? 'K' : 'k');
      const qSide = castling.includes(color === 'w' ? 'Q' : 'q');
      const king = b.squares[sq(4, rank)];
      if (king && king.type === 'k' && king.color === color) king.hasMoved = !(kSide || qSide);
      const rk = b.squares[sq(7, rank)];
      if (rk && rk.type === 'r' && rk.color === color) rk.hasMoved = !kSide;
      const rq = b.squares[sq(0, rank)];
      if (rq && rq.type === 'r' && rq.color === color) rq.hasMoved = !qSide;
    }
    const turn: Color = side === 'b' ? 'b' : 'w';
    if (ep !== '-') {
      const f = ep.charCodeAt(0) - 97;
      const r = parseInt(ep[1], 10) - 1;
      // The pawn that double-stepped belongs to the side NOT to move.
      const pawnRank = turn === 'w' ? r - 1 : r + 1;
      const pawnSquare = sq(f, pawnRank);
      const pawn = b.squares[pawnSquare];
      if (pawn && pawn.type === 'p') {
        b.epActive.push({ square: sq(f, r), pawnSquare, pawnId: pawn.id, pawnColor: pawn.color });
      }
    }
    return { board: b, turn };
  }

  clone(): Board {
    const b = new Board();
    b.squares = this.squares.map((p) => (p ? { ...p } : null));
    b.kings = [this.kings[0], this.kings[1]];
    b.epActive = this.epActive.map((e) => ({ ...e }));
    b.epPending = this.epPending.map((e) => ({ ...e }));
    return b;
  }

  pieceAt(s: Square): Piece | null {
    return this.squares[s];
  }

  pieces(color: Color): { piece: Piece; square: Square }[] {
    const out: { piece: Piece; square: Square }[] = [];
    for (let s = 0; s < 64; s++) {
      const p = this.squares[s];
      if (p && p.color === color) out.push({ piece: p, square: s });
    }
    return out;
  }

  findById(id: number): { piece: Piece; square: Square } | null {
    for (let s = 0; s < 64; s++) {
      const p = this.squares[s];
      if (p && p.id === id) return { piece: p, square: s };
    }
    return null;
  }

  /** Is square `s` attacked by any piece of colour `by`? */
  isAttacked(s: Square, by: Color): boolean {
    const f = fileOf(s);
    const r = rankOf(s);
    const at = (ff: number, rr: number): Piece | null =>
      ff < 0 || ff > 7 || rr < 0 || rr > 7 ? null : this.squares[rr * 8 + ff];

    // Pawns: a pawn of colour `by` attacks diagonally forward.
    const pr = r - (by === 'w' ? 1 : -1);
    for (const df of [-1, 1]) {
      const p = at(f + df, pr);
      if (p && p.color === by && p.type === 'p') return true;
    }
    for (const [df, dr] of KNIGHT) {
      const p = at(f + df, r + dr);
      if (p && p.color === by && p.type === 'n') return true;
    }
    for (const [df, dr] of KING) {
      const p = at(f + df, r + dr);
      if (p && p.color === by && p.type === 'k') return true;
    }
    for (const [df, dr] of ROOK_DIRS) {
      let ff = f + df;
      let rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const p = this.squares[rr * 8 + ff];
        if (p) {
          if (p.color === by && (p.type === 'r' || p.type === 'q')) return true;
          break;
        }
        ff += df;
        rr += dr;
      }
    }
    for (const [df, dr] of BISHOP_DIRS) {
      let ff = f + df;
      let rr = r + dr;
      while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) {
        const p = this.squares[rr * 8 + ff];
        if (p) {
          if (p.color === by && (p.type === 'b' || p.type === 'q')) return true;
          break;
        }
        ff += df;
        rr += dr;
      }
    }
    return false;
  }

  inCheck(color: Color): boolean {
    const k = this.kings[ci(color)];
    if (k < 0) return false;
    return this.isAttacked(k, color === 'w' ? 'b' : 'w');
  }

  /** Apply a move in place and return what is needed to undo it. Does not validate. */
  apply(m: Move): Undo {
    const mover = this.squares[m.from]!;
    const u: Undo = {
      move: m,
      mover,
      moverHadMoved: mover.hasMoved,
      captured: null,
      capturedSquare: m.to,
      wasPromotion: false,
      pushedEp: false,
    };
    if (m.flag === 'enPassant') {
      const capSq = sq(fileOf(m.to), rankOf(m.from));
      u.captured = this.squares[capSq];
      u.capturedSquare = capSq;
      this.squares[capSq] = null;
    } else if (this.squares[m.to]) {
      u.captured = this.squares[m.to];
    }
    if (u.captured && u.captured.type === 'k') this.kings[ci(u.captured.color)] = -1;

    this.squares[m.to] = mover;
    this.squares[m.from] = null;
    mover.hasMoved = true;
    if (mover.type === 'k') this.kings[ci(mover.color)] = m.to;

    if (m.flag === 'castleK' || m.flag === 'castleQ') {
      const rank = rankOf(m.from);
      const from = sq(m.flag === 'castleK' ? 7 : 0, rank);
      const to = sq(m.flag === 'castleK' ? 5 : 3, rank);
      const rook = this.squares[from]!;
      u.rook = { piece: rook, from, to, hadMoved: rook.hasMoved };
      this.squares[to] = rook;
      this.squares[from] = null;
      rook.hasMoved = true;
    }
    if (m.flag === 'promotion') {
      mover.type = 'q'; // auto-queen
      u.wasPromotion = true;
    }
    if (m.flag === 'double') {
      this.epPending.push({
        square: sq(fileOf(m.from), (rankOf(m.from) + rankOf(m.to)) >> 1),
        pawnSquare: m.to,
        pawnId: mover.id,
        pawnColor: mover.color,
      });
      u.pushedEp = true;
    }
    return u;
  }

  undo(u: Undo): void {
    const m = u.move;
    const mover = u.mover;
    if (u.pushedEp) this.epPending.pop();
    if (u.wasPromotion) mover.type = 'p';
    if (u.rook) {
      this.squares[u.rook.from] = u.rook.piece;
      this.squares[u.rook.to] = null;
      u.rook.piece.hasMoved = u.rook.hadMoved;
    }
    this.squares[m.from] = mover;
    this.squares[m.to] = null;
    mover.hasMoved = u.moverHadMoved;
    if (mover.type === 'k') this.kings[ci(mover.color)] = m.from;
    if (u.captured) {
      this.squares[u.capturedSquare] = u.captured;
      if (u.captured.type === 'k') this.kings[ci(u.captured.color)] = u.capturedSquare;
    }
  }

  /**
   * Turn boundary for en passant: this turn's double steps become the opponent's
   * targets; the old targets expire. Returns a snapshot for restoreEp.
   */
  endTurnEp(): { active: EpTarget[]; pending: EpTarget[] } {
    const snap = { active: this.epActive, pending: this.epPending };
    this.epActive = this.epPending.filter((e) => {
      const p = this.squares[e.pawnSquare];
      return !!p && p.id === e.pawnId && this.squares[e.square] === null;
    });
    this.epPending = [];
    return snap;
  }

  restoreEp(snap: { active: EpTarget[]; pending: EpTarget[] }): void {
    this.epActive = snap.active;
    this.epPending = snap.pending;
  }

  toAscii(): string {
    const rows: string[] = [];
    for (let r = 7; r >= 0; r--) {
      let row = '';
      for (let f = 0; f < 8; f++) {
        const p = this.squares[sq(f, r)];
        row += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
      }
      rows.push(row);
    }
    return rows.join('\n');
  }
}
