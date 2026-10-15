import { Board, ci } from '../engine/board';
import { Game, MovePicker } from '../engine/game';
import { givesCheck, legalMoves, pseudoMovesFrom, Rules } from '../engine/movegen';
import { Color, Move, opposite } from '../engine/types';
import { VALUE, leastAttacker, positional } from './eval';

export type Difficulty = 'easy' | 'medium' | 'hard';

/** How many candidate moves hard mode re-examines with a look at the reply. */
const HARD_CANDIDATES = 8;
const HARD_DEFENCE = 0.9;
const HARD_ATTACK = 0.5;

/** Value of whatever `m` captures (0 if nothing). */
function captureValue(board: Board, m: Move): number {
  if (m.captureId === undefined) return 0;
  if (m.flag === 'enPassant') return VALUE.p;
  const t = board.squares[m.to];
  return t ? VALUE[t.type] : 0;
}

interface Scored {
  move: Move;
  score: number;
}

/**
 * Heuristic value of one move. Deterministic given the board; no randomness here.
 * `heedRisk` lets easy mode sometimes ignore recapture danger.
 */
function baseScore(game: Game, m: Move, heedRisk: boolean): number {
  const board = game.board;
  const color = game.turn;
  const enemy = opposite(color);
  const piece = board.squares[m.from]!;

  let score = captureValue(board, m);

  // Getting a threatened piece out of danger is worth something.
  if (heedRisk && leastAttacker(board, m.from, enemy) < Infinity) {
    const defended = leastAttacker(board, m.from, color) < Infinity;
    const danger = defended ? Math.max(0, VALUE[piece.type] - leastAttacker(board, m.from, enemy)) : VALUE[piece.type];
    score += danger * 0.6;
  }
  const fromPos = positional(piece.type, color, m.from);

  const u = board.apply(m);
  const moved = board.squares[m.to]!;
  if (m.flag === 'promotion') score += 800;
  if (m.flag === 'castleK' || m.flag === 'castleQ') score += 35;

  if (heedRisk) {
    const attacker = leastAttacker(board, m.to, enemy);
    if (attacker < Infinity) {
      const defended = leastAttacker(board, m.to, color) < Infinity;
      const val = VALUE[moved.type];
      score -= defended ? Math.max(0, val - attacker) : val;
    }
  }
  // In king-capture mode, leaving our own king attackable is how games are lost.
  const ownKing = board.kings[ci(color)];
  if (heedRisk && ownKing >= 0 && game.rules.winRule === 'kingCapture' && leastAttacker(board, ownKing, enemy) < Infinity) {
    score -= 400;
  }
  // Pressure on the enemy king.
  const enemyKing = board.kings[ci(enemy)];
  if (enemyKing >= 0 && leastAttacker(board, enemyKing, color) < Infinity) score += 60;

  score += positional(moved.type, color, m.to) - fromPos;
  board.undo(u);
  return score;
}

/**
 * Sum of the best capture each of the enemy's top `slots` pieces could make
 * against us. Used by hard mode to see what a move leaves hanging.
 */
function enemyThreat(board: Board, enemy: Color, rules: Rules, slots: number): number {
  const best = new Map<number, number>();
  for (const m of legalMoves(board, enemy, rules)) {
    if (m.captureId === undefined) continue;
    let gain = captureValue(board, m);
    const attacker = board.squares[m.from]!;
    if (gain < VALUE.k && leastAttacker(board, m.to, opposite(enemy)) < Infinity) {
      gain = Math.max(0, gain - VALUE[attacker.type]);
    }
    if (gain > (best.get(m.pieceId) ?? 0)) best.set(m.pieceId, gain);
  }
  return [...best.values()]
    .sort((a, b) => b - a)
    .slice(0, slots)
    .reduce((a, b) => a + b, 0);
}

/** Best captures our still-unmoved pieces could make for the rest of this turn. */
function ownThreat(board: Board, color: Color, rules: Rules, moved: Set<number>, slots: number): number {
  const best = new Map<number, number>();
  for (const m of legalMoves(board, color, rules, moved)) {
    if (m.captureId === undefined) continue;
    let gain = captureValue(board, m);
    const attacker = board.squares[m.from]!;
    if (gain < VALUE.k && leastAttacker(board, m.to, opposite(color)) < Infinity) {
      gain = Math.max(0, gain - VALUE[attacker.type]);
    }
    if (gain > (best.get(m.pieceId) ?? 0)) best.set(m.pieceId, gain);
  }
  return [...best.values()]
    .sort((a, b) => b - a)
    .slice(0, slots)
    .reduce((a, b) => a + b, 0);
}

/**
 * Can an own piece that has not moved yet capture the enemy king right now?
 * With moves still to spare this turn, that wins the game in king-capture mode.
 */
function kingWinAvailable(board: Board, color: Color, rules: Rules, movedIds: Set<number>): boolean {
  const ek = board.kings[ci(opposite(color))];
  if (ek < 0) return false;
  for (let s = 0; s < 64; s++) {
    const p = board.squares[s];
    if (!p || p.color !== color || movedIds.has(p.id)) continue;
    for (const m of pseudoMovesFrom(board, s, rules)) if (m.to === ek && m.captureId !== undefined) return true;
  }
  return false;
}

function rank(game: Game, difficulty: Difficulty): Scored[] {
  const moves = game.legalMoves();
  const rng = game.rng;
  const scored: Scored[] = [];
  for (const move of moves) {
    let score: number;
    if (difficulty === 'easy') {
      const heed = rng.next() < 0.5;
      score = baseScore(game, move, heed) + (rng.next() - 0.5) * 300;
    } else {
      score = baseScore(game, move, true) + rng.next() * 3; // seeded tie-break
    }
    scored.push({ move, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Build the auto-mover for a difficulty. It picks the best (piece, move) pair
 * across every piece that has not moved yet, applies it, and gets called again
 * on the updated board until the turn ends.
 */
export function makePicker(difficulty: Difficulty): MovePicker {
  return (game: Game): Move | null => {
    const scored = rank(game, difficulty);
    if (scored.length === 0) return null;

    if (difficulty === 'easy') {
      const top = scored.slice(0, 4);
      return top[game.rng.int(top.length)].move;
    }
    if (difficulty === 'medium') return scored[0].move;

    // Hard: re-score the best few moves by the position they leave behind:
    // what the enemy could take next turn, what we threaten, and whether this
    // move lines up an immediate king capture later in this turn.
    const board = game.board;
    const color = game.turn;
    const enemy = opposite(color);
    const slotsLeft = game.quota - game.movesThisTurn - 1;
    let best = scored[0];
    let bestScore = -Infinity;
    for (const cand of scored.slice(0, HARD_CANDIDATES)) {
      let score = baseScore(game, cand.move, false);
      // In checkmate mode a check ends the turn, forfeiting the moves still to spare.
      if (game.rules.winRule === 'checkmate' && slotsLeft > 0 && givesCheck(board, cand.move)) {
        score -= 60 + 40 * slotsLeft;
      }
      const u = board.apply(cand.move);
      const snap = board.endTurnEp();
      const moved = new Set(game.movedIds);
      moved.add(cand.move.pieceId);
      if (u.rook) moved.add(u.rook.piece.id);
      if (game.rules.winRule === 'kingCapture' && slotsLeft > 0 && kingWinAvailable(board, color, game.rules, moved)) {
        score += 15000;
      }
      score -= enemyThreat(board, enemy, game.rules, game.settings.n) * HARD_DEFENCE;
      if (slotsLeft > 0) score += ownThreat(board, color, game.rules, moved, slotsLeft) * HARD_ATTACK;
      board.restoreEp(snap);
      board.undo(u);
      if (score > bestScore) {
        bestScore = score;
        best = cand;
      }
    }
    return best.move;
  };
}
