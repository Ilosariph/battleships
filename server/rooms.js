// Online match state. The server owns both boards, so clients never see the opponent's ships.
import crypto from "node:crypto";
import { allSunk, canPlace, fire, FLEET, isSunk, newBoard, SIZE } from "../public/js/battleships.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newCode(taken, rng = Math.random) {
  for (;;) {
    let code = "";
    for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(rng() * CODE_CHARS.length)];
    if (!taken.has(code)) return code;
  }
}

/** Validate a client fleet (`[{ r, c, vertical }]` in FLEET order); returns clean ships or null. */
export function validFleet(ships, noTouch = false) {
  if (!Array.isArray(ships) || ships.length !== FLEET.length) return null;
  const out = [];
  for (let i = 0; i < FLEET.length; i++) {
    const s = ships[i];
    if (!s || !Number.isInteger(s.r) || !Number.isInteger(s.c)) return null;
    const ship = { ...FLEET[i], r: s.r, c: s.c, vertical: !!s.vertical };
    if (!canPlace(out, ship, SIZE, -1, noTouch)) return null;
    out.push(ship);
  }
  return out;
}

export class Room {
  constructor(code, { quick = false, extraShot = false, noTouch = false, rng = Math.random } = {}) {
    this.code = code;
    this.quick = quick;
    this.extraShot = !!extraShot;
    this.noTouch = !!noTouch;
    this.rng = rng;
    this.seats = []; // { token, name, conn, board, ready, rematch }
    this.phase = "place"; // place | battle | over
    this.turn = 0;
    this.winner = -1;
    this.last = null;
    this.closed = false; // someone left; the room can't continue
    this.touched = Date.now();
  }

  get full() {
    return this.seats.length === 2;
  }

  seatOf(token) {
    return this.seats.findIndex((s) => s.token === token);
  }

  addPlayer(name) {
    if (this.full || this.closed) return -1;
    this.seats.push({ token: crypto.randomUUID(), name, conn: null, board: null, ready: false, rematch: false });
    return this.seats.length - 1;
  }

  /** Returns an error string or null. */
  setFleet(i, ships) {
    if (this.phase !== "place" || this.closed) return "Not placing ships right now.";
    const fleet = validFleet(ships, this.noTouch);
    if (!fleet) return "Invalid fleet.";
    const seat = this.seats[i];
    seat.board = newBoard(fleet, SIZE, this.noTouch);
    seat.ready = true;
    if (this.full && this.seats.every((s) => s.ready)) {
      this.phase = "battle";
      this.turn = this.rng() < 0.5 ? 0 : 1;
    }
    return null;
  }

  unready(i) {
    if (this.phase !== "place") return;
    this.seats[i].ready = false;
    this.seats[i].board = null;
  }

  /** Fire at the opponent of seat i. Returns the fire() result or null if not allowed. */
  fire(i, r, c) {
    if (this.phase !== "battle" || this.closed || this.turn !== i) return null;
    const board = this.seats[1 - i].board;
    const res = fire(board, r, c);
    if (!res) return null;
    this.last = { by: i, r, c, result: res.result, ship: res.ship ?? -1 };
    if (allSunk(board)) {
      this.phase = "over";
      this.winner = i;
    } else if (res.result === "miss" || !this.extraShot) {
      this.turn = 1 - i;
    }
    return res;
  }

  rematch(i) {
    if (this.phase !== "over" || this.closed) return;
    this.seats[i].rematch = true;
    if (!this.seats.every((s) => s.rematch)) return;
    for (const s of this.seats) Object.assign(s, { board: null, ready: false, rematch: false });
    Object.assign(this, { phase: "place", winner: -1, last: null });
  }

  /** A player left for good: the opponent wins a running battle. */
  leave(i) {
    if (this.phase === "battle" && this.full) {
      this.phase = "over";
      this.winner = 1 - i;
    }
    this.seats[i].left = true;
    this.closed = true;
  }

  stateFor(i) {
    const me = this.seats[i];
    const opp = this.seats[1 - i];
    const ob = opp?.board;
    const over = this.phase === "over";
    const last = this.last && {
      by: this.last.by === i ? "me" : "opp",
      r: this.last.r,
      c: this.last.c,
      result: this.last.result,
      // Name the ship only if it's mine or it just sank; a plain hit doesn't tell you which ship it was.
      ship:
        this.last.ship >= 0 && (this.last.by !== i || this.last.result === "sunk")
          ? this.seats[1 - this.last.by].board.ships[this.last.ship].name
          : null,
    };
    return {
      t: "state",
      code: this.code,
      phase: this.phase,
      extraShot: this.extraShot,
      noTouch: this.noTouch,
      closed: this.closed,
      myTurn: this.phase === "battle" && this.turn === i,
      winner: over ? (this.winner === i ? "me" : "opp") : null,
      last,
      me: { name: me.name, ready: me.ready, rematch: me.rematch, board: me.board },
      opp: opp
        ? {
            name: opp.name,
            connected: !!opp.conn,
            left: !!opp.left,
            ready: opp.ready,
            rematch: opp.rematch,
            shots: ob && this.phase !== "place" ? ob.shots : null,
            sunk: ob && this.phase !== "place" ? ob.ships.map((s) => isSunk(ob, s)) : FLEET.map(() => false),
            // Only sunk ships are revealed, or all of them once the game is over.
            ships: ob && this.phase !== "place" ? ob.ships.filter((s) => over || isSunk(ob, s)) : [],
          }
        : null,
    };
  }
}
