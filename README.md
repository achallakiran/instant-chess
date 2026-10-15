# Instant Chess

Chess with a twist: each turn, up to **N** of your pieces move (1 to 16), and the AI does the same.

- **Play it:** open `dist/instant-chess.html` in any browser (single self-contained file).
- **Win rules:** king capture, or real checkmate (a check-giving move ends that side's turn).
- **Toggles:** castling, N, auto-move for your other pieces, first-turn cap, AI difficulty (easy/medium/hard).
- En passant is supported; promotion is auto-queen.

## Develop

```
npm install
npm test          # engine + AI tests
npm run typecheck
npm run build     # writes dist/instant-chess.html
```

Layout: `src/engine` (rules, turn resolver, seeded RNG), `src/ai` (evaluator, auto-mover), `src/ui` (2D board, bundled into one HTML by `build.mjs`). A 3D Babylon.js renderer is planned next.
