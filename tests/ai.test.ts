import { describe, expect, it } from 'vitest';
import { Difficulty, makePicker } from '../src/ai';
import { Color, Game, MovePicker, WinRule, playTurn } from '../src/engine';

/** Play a full game; returns the winner. Throws if the AI ever plays an illegal move. */
function play(winRule: WinRule, n: number, seed: number, white: Difficulty, black: Difficulty, maxTurns = 200) {
  const g = new Game({ winRule, n, seed, maxTurns, castling: true });
  const pickers: Record<Color, MovePicker> = { w: makePicker(white), b: makePicker(black) };
  while (g.status === 'playing') {
    const side = g.turn;
    const events = playTurn(g, pickers[side]);
    const moves = events.filter((e) => e.type === 'move').length;
    expect(moves).toBeLessThanOrEqual(n);
  }
  return g;
}

describe('AI plays legal, finite games', () => {
  it('every difficulty, both modes, several N', () => {
    for (const winRule of ['kingCapture', 'checkmate'] as const) {
      for (const d of ['easy', 'medium', 'hard'] as const) {
        for (const n of [1, 3, 8, 16]) {
          const g = play(winRule, n, 11, d, d, 120);
          expect(g.status).toBe('over');
        }
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = play('checkmate', 4, 5, 'hard', 'medium', 80);
    const b = play('checkmate', 4, 5, 'hard', 'medium', 80);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
  });
});

describe('difficulty ordering', () => {
  const score = (strong: Difficulty, weak: Difficulty, winRule: WinRule, n: number) => {
    let pts = 0;
    let games = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const asWhite = play(winRule, n, seed, strong, weak);
      pts += asWhite.winner === 'w' ? 1 : asWhite.winner === 'draw' ? 0.5 : 0;
      const asBlack = play(winRule, n, seed + 100, weak, strong);
      pts += asBlack.winner === 'b' ? 1 : asBlack.winner === 'draw' ? 0.5 : 0;
      games += 2;
    }
    return pts / games;
  };

  for (const winRule of ['kingCapture', 'checkmate'] as const) {
    for (const n of [1, 4]) {
      it(`medium beats easy (${winRule}, N=${n})`, () => {
        expect(score('medium', 'easy', winRule, n)).toBeGreaterThanOrEqual(0.6);
      });
      it(`hard beats medium (${winRule}, N=${n})`, () => {
        expect(score('hard', 'medium', winRule, n)).toBeGreaterThanOrEqual(0.6);
      });
    }
  }
});
