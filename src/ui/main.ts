import { Difficulty, makePicker } from '../ai';
import {
  Color,
  Game,
  GameEvent,
  Move,
  MovePicker,
  PieceType,
  Square,
  WinRule,
  opposite,
  sq,
  squareName,
} from '../engine';

const GLYPH: Record<PieceType, string> = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const TEXT = '︎'; // force text (not emoji) presentation

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Config {
  winRule: WinRule;
  castling: boolean;
  n: number;
  autoMove: boolean;
  firstCap: boolean;
  difficulty: Difficulty;
}

let game: Game | null = null;
let human: Color = 'w';
let cfg: Config;
let picker: MovePicker;
let selected: Square | null = null;
let targets: Move[] = [];
let last = new Set<Square>();
let busy = false;
let turnMoves: string[] = [];
let sessionId = 0; // lets a stale animation stop when a new game starts

// ---------- setup ----------

const winHints: Record<WinRule, string> = {
  kingCapture: 'No check rules. The game ends the instant a king is captured, even mid-turn.',
  checkmate: 'Real check and checkmate. A move that gives check ends that side\'s turn.',
};

function refreshSetupHints() {
  $('winHint').textContent = winHints[($('winRule') as HTMLSelectElement).value as WinRule];
  $('nVal').textContent = ($('n') as HTMLInputElement).value;
}
['winRule', 'n'].forEach((id) => $(id).addEventListener('input', refreshSetupHints));
refreshSetupHints();

$('start').addEventListener('click', startGame);
$('again').addEventListener('click', showSetup);
$('newGame').addEventListener('click', showSetup);
$('endTurn').addEventListener('click', () => void endMyTurn());

function showSetup() {
  sessionId++;
  busy = false;
  $('banner').classList.remove('show');
  $('setup').classList.remove('hidden');
  $('play').classList.add('hidden');
}

function readConfig(): Config {
  return {
    winRule: ($('winRule') as HTMLSelectElement).value as WinRule,
    castling: ($('castling') as HTMLInputElement).checked,
    n: parseInt(($('n') as HTMLInputElement).value, 10),
    autoMove: ($('autoMove') as HTMLInputElement).checked,
    firstCap: ($('firstCap') as HTMLInputElement).checked,
    difficulty: ($('difficulty') as HTMLSelectElement).value as Difficulty,
  };
}

function startGame() {
  cfg = readConfig();
  const pick = ($('colour') as HTMLSelectElement).value;
  human = pick === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : (pick as Color);
  game = new Game({
    winRule: cfg.winRule,
    castling: cfg.castling,
    n: cfg.n,
    firstTurnCap: cfg.firstCap,
    seed: (Math.random() * 2 ** 31) | 0,
    maxTurns: 400,
  });
  picker = makePicker(cfg.difficulty);
  selected = null;
  targets = [];
  last = new Set();
  turnMoves = [];
  $('log').innerHTML = '';
  $('banner').classList.remove('show');
  $('setup').classList.add('hidden');
  $('play').classList.remove('hidden');
  $('logCard').classList.remove('hidden');
  const id = ++sessionId;
  render();
  void continueFlow(id);
}

// ---------- rendering ----------

function render() {
  if (!game) return;
  const g = game;
  const board = $('board');
  const flip = human === 'b';
  const checked: Square[] = [];
  if (cfg.winRule === 'checkmate') {
    for (const c of ['w', 'b'] as Color[]) if (g.board.inCheck(c)) checked.push(g.board.kings[c === 'w' ? 0 : 1]);
  }
  const targetMap = new Map<Square, Move>();
  for (const m of targets) targetMap.set(m.to, m);

  let html = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const rank = flip ? row : 7 - row;
      const file = flip ? 7 - col : col;
      const s = sq(file, rank);
      const p = g.board.squares[s];
      const light = (file + rank) % 2 === 1;
      const cls = ['sq', light ? 'l' : 'd'];
      if (last.has(s)) cls.push('last');
      if (selected === s) cls.push('sel');
      if (checked.includes(s)) cls.push('chk');
      const mine =
        !busy && g.status === 'playing' && g.turn === human && p && p.color === human && !g.movedIds.has(p.id);
      if (mine) cls.push('mine');
      if (p && p.color === human && g.turn === human && g.movedIds.has(p.id)) cls.push('used');
      const t = targetMap.get(s);
      if (t) cls.push('tgt', p || t.flag === 'enPassant' ? 'cap' : 'x');
      const coordF = row === 7 ? `<span class="coord f">${'abcdefgh'[file]}</span>` : '';
      const coordR = col === 0 ? `<span class="coord r">${rank + 1}</span>` : '';
      const piece = p ? `<span class="pc ${p.color}">${GLYPH[p.type]}${TEXT}</span>` : '';
      html += `<div class="${cls.join(' ')}" data-sq="${s}">${coordF}${coordR}${piece}</div>`;
    }
  }
  board.innerHTML = html;

  // status
  const mine = g.turn === human;
  const who = mine ? 'Your turn' : 'AI is thinking…';
  const colour = g.turn === 'w' ? '#fffaf0' : '#2a211b';
  if (g.status === 'playing') {
    $('status').innerHTML = `<span class="dot" style="background:${colour}"></span>${who} · moves ${g.movesThisTurn}/${g.quota}`;
    ($('meter') as HTMLElement).style.width = `${(g.movesThisTurn / Math.max(1, g.quota)) * 100}%`;
  } else {
    $('status').textContent = 'Game over';
  }
  $('rules').textContent =
    `${cfg.winRule === 'kingCapture' ? 'King capture' : 'Checkmate'} · N=${cfg.n}` +
    `${cfg.firstCap ? ' (first turn 1)' : ''} · castling ${cfg.castling ? 'on' : 'off'}` +
    ` · auto-move ${cfg.autoMove ? 'on' : 'off'} · AI ${cfg.difficulty}`;
  const canEnd = !busy && g.status === 'playing' && g.turn === human && g.movesThisTurn > 0 && !cfg.autoMove;
  ($('endTurn') as HTMLButtonElement).disabled = !canEnd;
}

$('board').addEventListener('click', (e) => {
  const el = (e.target as HTMLElement).closest('[data-sq]') as HTMLElement | null;
  if (el) onSquare(parseInt(el.dataset.sq!, 10));
});

function toast(msg: string) {
  const t = $('toast');
  t.textContent = msg;
  t.style.display = 'block';
  setTimeout(() => (t.style.display = 'none'), 1400);
}

// ---------- log ----------

function describe(e: GameEvent, captured: boolean): string {
  if (e.type !== 'move') return '';
  const m = e.move;
  if (m.flag === 'castleK') return 'O-O';
  if (m.flag === 'castleQ') return 'O-O-O';
  return `${GLYPH[e.pieceType]}${TEXT}${squareName(m.from)}${captured ? '×' : '-'}${squareName(m.to)}`;
}

function record(events: GameEvent[]) {
  if (!game) return;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === 'move') {
      const captured = events.some((x) => x.type === 'capture' && x.at !== undefined && (x.at === e.move.to || e.move.flag === 'enPassant'));
      turnMoves.push(describe(e, captured));
      last.add(e.move.from);
      last.add(e.move.to);
    } else if (e.type === 'promote') {
      turnMoves[turnMoves.length - 1] += '=♛';
    } else if (e.type === 'skip') {
      turnMoves.push('⊘ skip');
    } else if (e.type === 'check') {
      turnMoves[turnMoves.length - 1] += '+';
    } else if (e.type === 'turnEnd') {
      const mine = e.color === human;
      const note = e.reason === 'check' ? ' (check ends turn)' : e.reason === 'noMoves' ? ' (no more moves)' : '';
      const div = document.createElement('div');
      div.className = mine ? 'you' : 'ai';
      div.innerHTML = `<b>${mine ? 'You' : 'AI'}</b> · ${turnMoves.length ? turnMoves.join(', ') : 'pass'}${note}`;
      const log = $('log');
      log.appendChild(div);
      log.scrollTop = log.scrollHeight;
      turnMoves = [];
    } else if (e.type === 'gameOver') {
      showEnd(e);
    }
  }
}

function showEnd(e: Extract<GameEvent, { type: 'gameOver' }>) {
  let title: string;
  if (e.winner === 'draw') title = 'Draw';
  else title = e.winner === human ? 'You win!' : 'AI wins';
  const why: Record<string, string> = {
    kingCaptured: 'A king was captured.',
    checkmate: 'Checkmate.',
    stalemate: 'Stalemate — no legal moves.',
    noKing: 'A king is missing.',
    turnLimit: 'Turn limit reached.',
  };
  $('bannerTitle').textContent = title;
  $('bannerText').textContent = why[e.reason] ?? '';
  setTimeout(() => $('banner').classList.add('show'), 450);
}

// ---------- interaction ----------

function onSquare(s: Square) {
  if (!game || busy || game.status !== 'playing' || game.turn !== human) return;
  const hit = targets.find((m) => m.to === s);
  if (hit) {
    void humanPlay(hit);
    return;
  }
  const p = game.board.squares[s];
  if (p && p.color === human && !game.movedIds.has(p.id)) {
    const moves = game.legalMovesFor(p.id);
    if (moves.length) {
      selected = s;
      targets = moves;
    } else {
      selected = null;
      targets = [];
      toast('That piece has no moves');
    }
  } else {
    selected = null;
    targets = [];
  }
  render();
}

async function humanPlay(m: Move) {
  if (!game) return;
  const id = sessionId;
  busy = true;
  last = new Set();
  selected = null;
  targets = [];
  record(game.play(m));
  render();
  await continueFlow(id);
}

async function endMyTurn() {
  if (!game || busy || game.turn !== human) return;
  const id = sessionId;
  busy = true;
  last = new Set();
  selected = null;
  targets = [];
  record(game.endTurn('manual'));
  render();
  await continueFlow(id);
}

/** Runs whatever must happen next: auto-moves for the player, AI turns, or waiting for input. */
async function continueFlow(id: number) {
  if (!game) return;
  busy = true;
  render();
  while (game && game.status === 'playing' && id === sessionId) {
    if (game.turn === human) {
      if (cfg.autoMove && game.movesThisTurn >= 1) {
        await runSide(human, id);
        continue;
      }
      break; // wait for the player
    }
    await sleep(350);
    if (id !== sessionId) return;
    last = new Set();
    await runSide(opposite(human), id);
  }
  if (id !== sessionId) return;
  busy = false;
  render();
}

/** Plays one side's remaining moves this turn, one at a time, so the player can follow. */
async function runSide(color: Color, id: number) {
  if (!game) return;
  const turnNo = game.turnCount;
  const delay = Math.max(70, Math.min(320, 2600 / Math.max(1, game.quota)));
  while (game && id === sessionId && game.status === 'playing' && game.turn === color && game.turnCount === turnNo) {
    const m = picker(game);
    if (!m) {
      record(game.endTurn('manual'));
      render();
      break;
    }
    record(game.play(m));
    render();
    await sleep(delay);
  }
}

// Handy for debugging in the console.
(window as unknown as Record<string, unknown>).__instantChess = () => game;
