# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running

- `npm start` — Node server at http://localhost:5000 (static files + `/ws`).
- `npm test` — `node --test` (no dependencies).
- `docker compose up --build` — same server in a container on port 5000 (external `proxy` network).

## Architecture

No build step, no npm dependencies.

- **`public/js/battleships.js`** — pure logic, imported by both the browser and the server: `randomFleet`, `canPlace` (with `noTouch`, ships may not touch even diagonally), `fire` (on `noTouch` boards also marks deduced WATER cells), `aiShot(board, level)`.
- **`public/js/board.js`** — builds board DOM once; `paint()` only swaps cell classes.
- **`public/js/main.js`** — all UI. `vm()` turns either the local AI game or the latest server snapshot into one view model that `render()` draws.
- **`server/rooms.js`** — `Room`: seats with reconnect tokens, phases `place → battle → over`, `stateFor(seat)` hides unsunk enemy ships.
- **`server/server.js`** — HTTP + WebSocket, quick-match queue, idle room cleanup. `server/ws.js` is copied from games-landingpage.

**Key design decisions:**
- Shots grid: `0` unknown, `1` miss, `2` hit, `3` water (deduced, not fired at).
- The AI only sees what a player would see (shots + which ships are sunk).
- Online the server is authoritative; clients send `create`/`quick`/`join`/`fleet`/`unready`/`fire`/`rematch`/`leave` and receive full `state` snapshots.
- localStorage keys: `bs-settings`, `bs-game` (vs-computer save), `bs-stats`, `bs-online` (room code + seat token), `dark`.
