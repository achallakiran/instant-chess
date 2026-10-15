export type Color = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';

export interface Piece {
  type: PieceType;
  color: Color;
  /** Stable id so the renderer can track a piece across moves. */
  id: number;
  hasMoved: boolean;
}

/** Square index 0..63. 0 = a1, 7 = h1, 56 = a8, 63 = h8. */
export type Square = number;

export type WinRule = 'kingCapture' | 'checkmate';

export interface Settings {
  winRule: WinRule;
  castling: boolean;
  /** Max pieces that move per turn (1..16). */
  n: number;
  /** Seed for deterministic tie-breaking. */
  seed: number;
  /** Turns (both sides counted) after which the game is drawn. */
  maxTurns: number;
  /** If true, each side's opening turn is limited to one move (stops a first-move snowball). */
  firstTurnCap: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  winRule: 'kingCapture',
  castling: true,
  n: 1,
  seed: 1,
  maxTurns: 400,
  firstTurnCap: false,
};

export type MoveFlag = 'normal' | 'double' | 'enPassant' | 'castleK' | 'castleQ' | 'promotion';

export interface Move {
  from: Square;
  to: Square;
  pieceId: number;
  flag: MoveFlag;
  /** Id of captured piece, if any (en passant included). */
  captureId?: number;
}

export type GameEvent =
  | { type: 'move'; color: Color; move: Move; pieceType: PieceType }
  | { type: 'capture'; color: Color; pieceId: number; pieceType: PieceType; at: Square }
  | { type: 'promote'; color: Color; pieceId: number; at: Square }
  | { type: 'castle'; color: Color; side: 'K' | 'Q' }
  | { type: 'skip'; color: Color; pieceId: number }
  | { type: 'check'; color: Color }
  | { type: 'turnEnd'; color: Color; moves: number; reason: 'quota' | 'noMoves' | 'check' | 'gameOver' | 'manual' }
  | { type: 'gameOver'; winner: Color | 'draw'; reason: 'kingCaptured' | 'checkmate' | 'stalemate' | 'noKing' | 'turnLimit' };

export const sq = (file: number, rank: number): Square => rank * 8 + file;
export const fileOf = (s: Square) => s & 7;
export const rankOf = (s: Square) => s >> 3;
export const opposite = (c: Color): Color => (c === 'w' ? 'b' : 'w');

export function squareName(s: Square): string {
  return 'abcdefgh'[fileOf(s)] + (rankOf(s) + 1);
}
export function parseSquare(name: string): Square {
  return sq(name.charCodeAt(0) - 97, parseInt(name[1], 10) - 1);
}
