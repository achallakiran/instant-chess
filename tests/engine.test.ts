import { describe, expect, it } from 'vitest';
import {
  Board,
  Color,
  Game,
  GameEvent,
  Move,
  Rules,
  legalMoves,
  opposite,
  parseSquare,
  playTurn,
  randomPicker,
} from '../src/engine';

const CHECKMATE: Rules = { winRule: 'checkmate', castling: true };

function perft(board: Board, color: Color, rules: Rules, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(board, color, rules);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const u = board.apply(m);
    const snap = board.endTurnEp();
    n += perft(board, opposite(color), rules, depth - 1);
    board.restoreEp(snap);
    board.undo(u);
  }
  return n;
}

function perftFen(fen: string, rules: Rules, depth: number): number {
  const { board, turn } = Board.fromFen(fen);
  return perft(board, turn, rules, depth);
}

const find = (g: Game, from: string, to: string): Move => {
  const m = g.legalMoves().find((x) => x.from === parseSquare(from) && x.to === parseSquare(to));
  if (!m) throw new Error(`No legal move ${from}${to}`);
  return m;
};

const types = (events: GameEvent[]) => events.map((e) => e.type);

describe('move generation (perft, standard chess rules)', () => {
  it('start position', () => {
    const fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -';
    expect([1, 2, 3, 4].map((d) => perftFen(fen, CHECKMATE, d))).toEqual([20, 400, 8902, 197281]);
  });

  it('kiwipete (castling, pins, en passant)', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -';
    expect([1, 2, 3].map((d) => perftFen(fen, CHECKMATE, d))).toEqual([48, 2039, 97862]);
  });

  it('endgame with en passant and discovered checks', () => {
    const fen = '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -';
    expect([1, 2, 3, 4].map((d) => perftFen(fen, CHECKMATE, d))).toEqual([14, 191, 2812, 43238]);
  });

  it('castling toggle off removes the two castling moves', () => {
    const fen = 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -';
    expect(perftFen(fen, { winRule: 'checkmate', castling: false }, 1)).toBe(46);
  });
});

describe('win rules', () => {
  const fen = '4k3/8/8/8/8/8/r7/4K3 w - -';

  it('checkmate mode forbids moving into attack', () => {
    const g = new Game({ winRule: 'checkmate' }, fen);
    expect(g.legalMoves().length).toBe(2); // d1, f1 only
  });

  it('king-capture mode has no check rules', () => {
    const g = new Game({ winRule: 'kingCapture' }, fen);
    expect(g.legalMoves().length).toBe(5);
  });

  it('king capture ends the game', () => {
    const g = new Game({ winRule: 'kingCapture' }, '4k3/8/8/8/8/8/4r3/4K3 b - -');
    const events = g.play(find(g, 'e2', 'e1'));
    expect(g.status).toBe('over');
    expect(g.winner).toBe('b');
    expect(events.some((e) => e.type === 'gameOver' && e.reason === 'kingCaptured')).toBe(true);
  });

  it('detects checkmate', () => {
    const g = new Game({ winRule: 'checkmate' }, '6k1/5ppp/8/8/8/8/8/R3K3 w - -');
    const events = g.play(find(g, 'a1', 'a8'));
    expect(g.status).toBe('over');
    expect(g.winner).toBe('w');
    expect(events.some((e) => e.type === 'gameOver' && e.reason === 'checkmate')).toBe(true);
  });

  it('detects stalemate as a draw', () => {
    const g = new Game({ winRule: 'checkmate' }, '7k/5Q2/6K1/8/8/8/8/8 b - -');
    expect(g.status).toBe('over');
    expect(g.winner).toBe('draw');
  });

  it('a check-giving move ends the turn even with moves left', () => {
    const g = new Game({ winRule: 'checkmate', n: 3, castling: false }, '4k3/8/8/8/8/8/R7/4K2R w - -');
    const events = g.play(find(g, 'a2', 'a8'));
    expect(types(events)).toContain('check');
    expect(events.find((e) => e.type === 'turnEnd')).toMatchObject({ reason: 'check', moves: 1 });
    expect(g.turn).toBe('b');
    expect(g.movesThisTurn).toBe(0);
  });
});

describe('special moves', () => {
  it('promotion is automatic queen', () => {
    const g = new Game({ winRule: 'kingCapture' }, '7k/P7/8/8/8/8/8/K7 w - -');
    const events = g.play(find(g, 'a7', 'a8'));
    expect(types(events)).toContain('promote');
    expect(g.board.squares[parseSquare('a8')]!.type).toBe('q');
  });

  it('en passant survives other moves within the capturer\'s whole next turn', () => {
    const g = new Game({ winRule: 'kingCapture', n: 2 }, '4k3/3p4/8/4P3/8/8/8/R3K3 b - -');
    g.play(find(g, 'd7', 'd5'));
    g.play(find(g, 'e8', 'e7')); // quota reached, turn passes to white
    expect(g.turn).toBe('w');
    g.play(find(g, 'a1', 'a2')); // a different piece moves first
    const ep = g.legalMoves().find((m) => m.flag === 'enPassant');
    expect(ep).toBeDefined();
    const events = g.play(ep!);
    expect(types(events)).toContain('capture');
    expect(g.board.squares[parseSquare('d5')]).toBeNull();
    expect(g.board.squares[parseSquare('d6')]!.type).toBe('p');
  });

  it('en passant expires after the capturer\'s turn', () => {
    const g = new Game({ winRule: 'kingCapture', n: 1 }, '4k3/3p4/8/4P3/8/8/8/R3K3 b - -');
    g.play(find(g, 'd7', 'd5'));
    g.play(find(g, 'a1', 'a2')); // white declines
    g.play(find(g, 'e8', 'e7'));
    expect(g.legalMoves().some((m) => m.flag === 'enPassant')).toBe(false);
  });

  it('castles when allowed and not when toggled off', () => {
    const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq -';
    const on = new Game({ winRule: 'checkmate', castling: true }, fen);
    expect(on.legalMoves().filter((m) => m.flag === 'castleK' || m.flag === 'castleQ').length).toBe(2);
    const off = new Game({ winRule: 'checkmate', castling: false }, fen);
    expect(off.legalMoves().some((m) => m.flag === 'castleK' || m.flag === 'castleQ')).toBe(false);
  });

  it('checkmate mode forbids castling through an attacked square', () => {
    const g = new Game({ winRule: 'checkmate', castling: true }, '4k3/8/8/8/8/8/5r2/R3K2R w KQ -');
    const flags = g.legalMoves().map((m) => m.flag);
    expect(flags).not.toContain('castleK');
    expect(flags).toContain('castleQ');
  });

  it('king-capture mode ignores castling safety', () => {
    const g = new Game({ winRule: 'kingCapture', castling: true }, '4k3/8/8/8/8/8/5r2/R3K2R w KQ -');
    expect(g.legalMoves().map((m) => m.flag)).toContain('castleK');
  });
});

describe('turn resolver', () => {
  it('lets the side move N pieces, one move each', () => {
    const g = new Game({ winRule: 'kingCapture', n: 5, seed: 7 });
    const events = playTurn(g, randomPicker);
    const moves = events.filter((e) => e.type === 'move');
    expect(moves.length).toBe(5);
    expect(new Set(moves.map((e) => (e.type === 'move' ? e.move.pieceId : -1))).size).toBe(5);
    expect(g.turn).toBe('b');
  });

  it('a blocked piece skips its slot', () => {
    const g = new Game({ winRule: 'kingCapture', n: 2 }, '4k3/8/8/8/8/4p3/4P3/4K3 w - -');
    const pawn = g.board.squares[parseSquare('e2')]!;
    const events = g.play(find(g, 'e1', 'd1'));
    expect(events.find((e) => e.type === 'skip')).toMatchObject({ pieceId: pawn.id });
    expect(events.find((e) => e.type === 'turnEnd')).toMatchObject({ reason: 'noMoves', moves: 1 });
    expect(g.turn).toBe('b');
  });

  it('quota is capped by the number of pieces', () => {
    const g = new Game({ winRule: 'kingCapture', n: 16 }, '4k3/8/8/8/8/8/8/4K3 w - -');
    expect(g.quota).toBe(1);
  });

  it("first-turn cap limits each side's opening turn only", () => {
    const g = new Game({ winRule: 'kingCapture', n: 4, seed: 2, firstTurnCap: true });
    expect(g.quota).toBe(1);
    playTurn(g, randomPicker);
    expect(g.turn).toBe('b');
    expect(g.quota).toBe(1); // black's opening turn is capped too
    playTurn(g, randomPicker);
    expect(g.turn).toBe('w');
    expect(g.quota).toBe(4);
  });

  it('rejects illegal moves and bad N', () => {
    const g = new Game({ winRule: 'kingCapture' });
    expect(() => g.play({ from: 0, to: 63, pieceId: 0, flag: 'normal' })).toThrow();
    expect(() => new Game({ n: 17 })).toThrow();
    expect(() => new Game({ n: 0 })).toThrow();
  });
});

describe('simulation invariants', () => {
  const runGame = (winRule: 'kingCapture' | 'checkmate', n: number, seed: number, maxTurns = 300) => {
    const g = new Game({ winRule, n, seed, castling: true });
    let turns = 0;
    while (g.status === 'playing' && turns++ < maxTurns) {
      const side = g.turn;
      const events = playTurn(g, randomPicker);
      const moves = events.filter((e) => e.type === 'move');
      expect(moves.length).toBeLessThanOrEqual(n);
      const ids = moves.map((e) => (e.type === 'move' ? e.move.pieceId : -1));
      expect(new Set(ids).size).toBe(ids.length);
      if (winRule === 'checkmate') expect(g.board.inCheck(side)).toBe(false);
      for (const c of [0, 1] as const) {
        const k = g.board.kings[c];
        if (k >= 0) expect(g.board.squares[k]!.type).toBe('k');
      }
    }
    return g;
  };

  it('random play never breaks the rules, in both modes and many N', () => {
    for (const winRule of ['kingCapture', 'checkmate'] as const) {
      for (const n of [1, 2, 4, 8, 16]) {
        for (const seed of [1, 2, 3]) runGame(winRule, n, seed);
      }
    }
  });

  it('high N kingCapture games end quickly', () => {
    const g = runGame('kingCapture', 16, 5, 200);
    expect(g.status).toBe('over');
    expect(g.turnCount).toBeLessThan(60);
  });

  it('same seed gives an identical event log; different seed does not', () => {
    const a = runGame('checkmate', 4, 42, 80);
    const b = runGame('checkmate', 4, 42, 80);
    const c = runGame('checkmate', 4, 43, 80);
    expect(JSON.stringify(a.log)).toBe(JSON.stringify(b.log));
    expect(JSON.stringify(a.log)).not.toBe(JSON.stringify(c.log));
  });
});
