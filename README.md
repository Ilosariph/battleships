# Battleships

Ad-free Battleships in the browser. Play the computer (Easy / Normal / Hard) or a friend online.

A small Node server (no npm dependencies) serves `public/` and runs online matches over a WebSocket at `/ws`. Games against the computer run entirely client-side.

## Features

- **vs Computer**: Easy (mostly random), Normal (hunt/target with checkerboard search), Hard (probability density over every possible ship placement). Win/loss record and best win per difficulty.
- **vs Player online**: create a room and share the 4-letter code or invite link, or use *Quick match* to pair with whoever is waiting. The server owns both boards, so nobody can peek at the other fleet. Reloading or a dropped connection rejoins the same seat.
- Classic fleet (5, 4, 3, 3, 2) on a 10×10 grid. Ships may touch by default; with the optional "Ships can't touch" rule, squares next to hits and around sunk ships are marked as water automatically.
- Drag ships to place them, tap to rotate (or `R`), *Shuffle* for a random layout.
- Optional "Hit = shoot again" rule. Keyboard targeting with arrow keys and `Enter`.
- vs-computer games auto-save to `localStorage`; light/dark theme.

## Run

```sh
docker compose up -d --build   # port 5000 (expects the external `proxy` network)
npm start                      # → http://localhost:5000 (Node >= 20)
```

The reverse proxy in front must forward WebSocket upgrades for `/ws`.

| Env | Default | |
| --- | --- | --- |
| `PORT` | `5000` | HTTP + WebSocket port |
| `MAX_CLIENTS` | `300` | Max concurrent WebSocket connections |
| `MAX_ROOMS` | `500` | Max open rooms |

## Test

```sh
npm test                       # logic, AI and room tests (node --test, no deps)
```

## Layout

| Path | Purpose |
| --- | --- |
| `public/js/battleships.js` | Pure game logic: fleet placement, firing, computer opponent (shared with the server) |
| `public/js/board.js` | Board and fleet-tracker rendering |
| `public/js/main.js` | Menu, placement, vs-computer and online game flow |
| `server/rooms.js` | Online room state and validation |
| `server/server.js` | Static file server, WebSocket message handling, room cleanup |
| `server/ws.js` | Minimal WebSocket implementation |
| `Dockerfile`, `docker-compose.yml` | Container image and compose file |
