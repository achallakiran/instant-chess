import { Board } from './board';
import { givesCheck, legalMoves, sameMove, Rules } from './movegen';
import { Rng } from './rng';
import { Color, DEFAULT_SETTINGS, GameEvent, Move, Settings, opposite } from './types';

export type Status = 'playing' | 'over';

/** Chooses the next move for the side to move, or null to stop moving this turn. */
export type MovePicker = (game: Game) => Move | null;

/**
 * One game of Instant Chess.
 *
 * A turn lets the side to move make up to N moves, each with a different piece.
 * Every call returns/records GameEvents so a renderer can replay what happened.
 */
export class Game {
  board: Board;
  settings: Settings;
  rules: Rules;
  rng: Rng;
  turn: Color;
  status: Status = 'playing';
  winner: Color | 'draw' | null = null;
  turnCount = 0;
  /** Pieces that already moved in the current turn (castling marks king and rook). */
  movedIds = new Set<number>();
  movesThisTurn = 0;
  log: GameEvent[] = [];
  private consecutiveNoMoveTurns = 0;

  constructor(settings: Partial<Settings> = {}, fen?: string) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    if (this.settings.n < 1 || this.settings.n > 16) throw new Error('n must be between 1 and 16');
    this.rules = { winRule: this.settings.winRule, castling: this.settings.castling };
    this.rng = new Rng(this.settings.seed);
    if (fen) {
      const parsed = Board.fromFen(fen);
      this.board = parsed.board;
      this.turn = parsed.turn;
    } else {
      this.board = Board.start();
      this.turn = 'w';
    }
    this.beginTurn();
  }

  /** Max moves the side to move can make this turn. */
  get quota(): number {
    const n = this.settings.firstTurnCap && this.turnCount < 2 ? 1 : this.settings.n;
    return Math.min(n, this.board.pieces(this.turn).length);
  }

  /** Legal moves for the side to move, excluding pieces that already moved this turn. */
  legalMoves(): Move[] {
    if (this.status !== 'playing') return [];
    return legalMoves(this.board, this.turn, this.rules, this.movedIds);
  }

  legalMovesFor(pieceId: number): Move[] {
    return this.legalMoves().filter((m) => m.pieceId === pieceId);
  }

  /** Play one move for the side to move. Returns the events it produced. */
  play(move: Move): GameEvent[] {
    if (this.status !== 'playing') throw new Error('Game is over');
    const legal = this.legalMoves().find((m) => sameMove(m, move));
    if (!legal) throw new Error(`Illegal move ${move.from}->${move.to} (${move.flag})`);
    const start = this.log.length;
    const color = this.turn;
    const mover = this.board.squares[legal.from]!;
    const pieceType = mover.type;

    // Computed before the move so the check test sees the position after it.
    const check = this.rules.winRule === 'checkmate' && givesCheck(this.board, legal);

    const u = this.board.apply(legal);
    this.movedIds.add(legal.pieceId);
    if (u.rook) this.movedIds.add(u.rook.piece.id);
    this.movesThisTurn++;

    this.emit({ type: 'move', color, move: legal, pieceType });
    if (legal.flag === 'castleK' || legal.flag === 'castleQ') {
      this.emit({ type: 'castle', color, side: legal.flag === 'castleK' ? 'K' : 'Q' });
    }
    if (u.captured) {
      this.emit({
        type: 'capture',
        color,
        pieceId: u.captured.id,
        pieceType: u.captured.type,
        at: u.capturedSquare,
      });
    }
    if (u.wasPromotion) this.emit({ type: 'promote', color, pieceId: legal.pieceId, at: legal.to });

    if (u.captured && u.captured.type === 'k') {
      this.finish(color, 'kingCaptured');
      this.endTurnInternal('gameOver');
    } else if (check) {
      this.emit({ type: 'check', color: opposite(color) });
      this.endTurn('check');
    } else if (this.movesThisTurn >= this.quota) {
      this.endTurn('quota');
    } else if (this.legalMoves().length === 0) {
      this.endTurn('noMoves');
    }
    return this.log.slice(start);
  }

  /** End the turn early (the player chose to stop, or the picker had nothing to play). */
  endTurn(reason: 'quota' | 'noMoves' | 'check' | 'manual' = 'manual'): GameEvent[] {
    if (this.status !== 'playing') return [];
    const start = this.log.length;
    if (reason === 'noMoves') {
      // Pieces that could not move miss their slot; one skip per unused slot.
      const unused = this.quota - this.movesThisTurn;
      let skips = 0;
      for (const { piece } of this.board.pieces(this.turn)) {
        if (skips >= unused) break;
        if (this.movedIds.has(piece.id)) continue;
        this.emit({ type: 'skip', color: this.turn, pieceId: piece.id });
        skips++;
      }
    }
    this.endTurnInternal(reason);
    this.turn = opposite(this.turn);
    this.turnCount++;
    if (this.turnCount >= this.settings.maxTurns) this.finish('draw', 'turnLimit');
    else this.beginTurn();
    return this.log.slice(start);
  }

  private endTurnInternal(reason: 'quota' | 'noMoves' | 'check' | 'gameOver' | 'manual') {
    this.emit({ type: 'turnEnd', color: this.turn, moves: this.movesThisTurn, reason });
    this.board.endTurnEp();
  }

  private beginTurn(depth = 0): void {
    if (this.status !== 'playing') return;
    if (reasonGameOver(this)) return;
    this.movedIds = new Set();
    this.movesThisTurn = 0;
    const moves = legalMoves(this.board, this.turn, this.rules);

    if (this.rules.winRule === 'checkmate') {
      if (moves.length === 0) {
        if (this.board.inCheck(this.turn)) this.finish(opposite(this.turn), 'checkmate');
        else this.finish('draw', 'stalemate');
      }
      return;
    }
    // King-capture mode: a side with no moves at all just passes.
    if (moves.length === 0) {
      this.consecutiveNoMoveTurns++;
      if (this.consecutiveNoMoveTurns >= 2 || depth > 2) {
        this.finish('draw', 'stalemate');
        return;
      }
      this.emit({ type: 'turnEnd', color: this.turn, moves: 0, reason: 'noMoves' });
      this.board.endTurnEp();
      this.turn = opposite(this.turn);
      this.turnCount++;
      this.beginTurn(depth + 1);
      return;
    }
    this.consecutiveNoMoveTurns = 0;
  }

  private finish(winner: Color | 'draw', reason: 'kingCaptured' | 'checkmate' | 'stalemate' | 'noKing' | 'turnLimit') {
    this.status = 'over';
    this.winner = winner;
    this.emit({ type: 'gameOver', winner, reason });
  }

  private emit(e: GameEvent) {
    this.log.push(e);
  }
}

function reasonGameOver(g: Game): boolean {
  // A board loaded without a king is over immediately in king-capture mode.
  if (g.rules.winRule !== 'kingCapture') return false;
  const hasW = g.board.kings[0] >= 0;
  const hasB = g.board.kings[1] >= 0;
  if (hasW && hasB) return false;
  g.status = 'over';
  g.winner = hasW ? 'w' : hasB ? 'b' : 'draw';
  g.log.push({ type: 'gameOver', winner: g.winner, reason: 'noKing' });
  return true;
}

/**
 * Run a whole turn: ask `picker` for moves until the turn ends.
 * Returns the events produced. If the picker returns null, the turn is ended.
 */
export function playTurn(game: Game, picker: MovePicker): GameEvent[] {
  const start = game.log.length;
  const side = game.turn;
  const turnNo = game.turnCount;
  while (game.status === 'playing' && game.turn === side && game.turnCount === turnNo) {
    const before = game.log.length;
    const m = picker(game);
    if (!m) {
      game.endTurn('manual');
      break;
    }
    game.play(m);
    if (game.log.length === before) break; // safety: no progress
  }
  return game.log.slice(start);
}

/** Simple seeded picker used by tests: random piece, then random move for it. */
export const randomPicker: MovePicker = (game) => {
  const moves = game.legalMoves();
  if (moves.length === 0) return null;
  const ids = [...new Set(moves.map((m) => m.pieceId))];
  const id = game.rng.pick(ids);
  return game.rng.pick(moves.filter((m) => m.pieceId === id));
};
