// Pure game logic: fleet placement, firing, computer opponent. No DOM.

export const SIZE = 10;
export const FLEET = [
  { name: 'Carrier', len: 5 },
  { name: 'Battleship', len: 4 },
  { name: 'Cruiser', len: 3 },
  { name: 'Submarine', len: 3 },
  { name: 'Destroyer', len: 2 },
];
export const LEVELS = ['easy', 'normal', 'hard'];

// shots[r][c]
export const UNKNOWN = 0;
export const MISS = 1;
export const HIT = 2;
export const WATER = 3; // never fired at, but known empty (next to a hit or sunk ship)

const ORTHO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
const AROUND = [...ORTHO, ...DIAG];

export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const inBounds = (r, c, size) => r >= 0 && c >= 0 && r < size && c < size;
export const emptyGrid = (size, v = 0) => Array.from({ length: size }, () => Array(size).fill(v));

/** Cells of a ship `{ r, c, len, vertical }`, bow first. */
export function cellsOf({ r, c, len, vertical }) {
  return Array.from({ length: len }, (_, i) => (vertical ? [r + i, c] : [r, c + i]));
}

/** Ships must be in bounds and may not touch each other, not even diagonally. */
export function canPlace(ships, ship, size = SIZE, ignore = -1) {
  const cells = cellsOf(ship);
  if (!cells.every(([r, c]) => inBounds(r, c, size))) return false;
  return ships.every((other, i) => i === ignore || cellsOf(other).every(([or, oc]) =>
    cells.every(([r, c]) => Math.abs(r - or) > 1 || Math.abs(c - oc) > 1)));
}

export function randomFleet(rng = Math.random, size = SIZE) {
  for (;;) {
    const ships = [];
    for (const { name, len } of FLEET) {
      for (let t = 0; t < 300; t++) {
        const vertical = rng() < 0.5;
        const ship = {
          name, len, vertical,
          r: Math.floor(rng() * (vertical ? size - len + 1 : size)),
          c: Math.floor(rng() * (vertical ? size : size - len + 1)),
        };
        if (canPlace(ships, ship, size)) { ships.push(ship); break; }
      }
    }
    if (ships.length === FLEET.length) return ships;
  }
}

export const newBoard = (ships, size = SIZE) => ({ size, ships: ships.map(s => ({ ...s })), shots: emptyGrid(size) });

export function shipAt(board, r, c) {
  return board.ships.findIndex(s => cellsOf(s).some(([sr, sc]) => sr === r && sc === c));
}

export const isSunk = (board, ship) => cellsOf(ship).every(([r, c]) => board.shots[r][c] === HIT);
export const allSunk = board => board.ships.every(s => isSunk(board, s));

/**
 * Fire at (r, c). Returns null if the cell can't be targeted, otherwise
 * `{ result: 'miss' | 'hit' | 'sunk', ship?, marks }` where `marks` are the cells
 * newly deduced as WATER: diagonals of a hit and the whole border of a sunk ship.
 */
export function fire(board, r, c) {
  const { shots, size } = board;
  if (!inBounds(r, c, size) || shots[r][c] !== UNKNOWN) return null;
  const i = shipAt(board, r, c);
  if (i < 0) {
    shots[r][c] = MISS;
    return { result: 'miss', marks: [] };
  }
  shots[r][c] = HIT;
  const marks = [];
  const mark = (rr, cc) => {
    if (inBounds(rr, cc, size) && shots[rr][cc] === UNKNOWN) {
      shots[rr][cc] = WATER;
      marks.push([rr, cc]);
    }
  };
  for (const [dr, dc] of DIAG) mark(r + dr, c + dc);
  const ship = board.ships[i];
  if (!isSunk(board, ship)) return { result: 'hit', ship: i, marks };
  for (const [sr, sc] of cellsOf(ship)) for (const [dr, dc] of AROUND) mark(sr + dr, sc + dc);
  return { result: 'sunk', ship: i, marks };
}

// ── Computer opponent ──
// The AI only uses what a human would know: misses, hits, deduced water and
// which ships have been sunk.

const OPEN = 0;
const BLOCKED = 1;
const OPEN_HIT = 2; // hit on a ship that isn't sunk yet
const SUNK = 3;

function viewOf(board) {
  const v = board.shots.map(row => row.map(s => (s === UNKNOWN ? OPEN : s === HIT ? OPEN_HIT : BLOCKED)));
  for (const s of board.ships) if (isSunk(board, s)) for (const [r, c] of cellsOf(s)) v[r][c] = SUNK;
  return v;
}

function cellsWhere(v, kind) {
  const out = [];
  v.forEach((row, r) => row.forEach((x, c) => { if (x === kind) out.push([r, c]); }));
  return out;
}

function openNeighbours(v, cells) {
  const out = [];
  for (const [r, c] of cells) {
    for (const [dr, dc] of ORTHO) {
      const rr = r + dr, cc = c + dc;
      if (inBounds(rr, cc, v.length) && v[rr][cc] === OPEN && !out.some(([a, b]) => a === rr && b === cc)) out.push([rr, cc]);
    }
  }
  return out;
}

/** Open cells continuing a line of two or more hits. */
function lineEnds(v, hits) {
  const out = [];
  const n = v.length;
  for (const [r, c] of hits) {
    for (const [dr, dc] of ORTHO) {
      const br = r - dr, bc = c - dc;
      if (!inBounds(br, bc, n) || v[br][bc] !== OPEN_HIT) continue;
      let rr = r + dr, cc = c + dc;
      while (inBounds(rr, cc, n) && v[rr][cc] === OPEN_HIT) { rr += dr; cc += dc; }
      if (inBounds(rr, cc, n) && v[rr][cc] === OPEN) out.push([rr, cc]);
    }
  }
  return out;
}

function easyShot(v, rng) {
  const hits = cellsWhere(v, OPEN_HIT);
  if (hits.length && rng() < 0.35) {
    const near = openNeighbours(v, hits);
    if (near.length) return pick(near, rng);
  }
  return pick(cellsWhere(v, OPEN), rng);
}

function normalShot(v, rng) {
  const hits = cellsWhere(v, OPEN_HIT);
  if (hits.length) {
    const ends = lineEnds(v, hits);
    if (ends.length) return pick(ends, rng);
    const near = openNeighbours(v, hits);
    if (near.length) return pick(near, rng);
  }
  const open = cellsWhere(v, OPEN);
  const checker = open.filter(([r, c]) => (r + c) % 2 === 0);
  return pick(checker.length ? checker : open, rng);
}

/** Probability density: count every placement of every remaining ship that fits what is known. */
function hardShot(v, remaining, rng) {
  const n = v.length;
  const score = emptyGrid(n);
  for (const len of remaining) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        for (const vertical of [false, true]) {
          const cells = cellsOf({ r, c, len, vertical });
          if (!cells.every(([rr, cc]) => inBounds(rr, cc, n) && (v[rr][cc] === OPEN || v[rr][cc] === OPEN_HIT))) continue;
          // A ship next to an open hit it doesn't contain would touch another ship.
          const inside = (rr, cc) => cells.some(([a, b]) => a === rr && b === cc);
          const touches = cells.some(([rr, cc]) => ORTHO.some(([dr, dc]) => {
            const ar = rr + dr, ac = cc + dc;
            return inBounds(ar, ac, n) && v[ar][ac] === OPEN_HIT && !inside(ar, ac);
          }));
          if (touches) continue;
          const k = cells.filter(([rr, cc]) => v[rr][cc] === OPEN_HIT).length;
          const w = k ? 50 ** k : 1;
          for (const [rr, cc] of cells) if (v[rr][cc] === OPEN) score[rr][cc] += w;
        }
      }
    }
  }
  let best = 0;
  let cands = [];
  for (const [r, c] of cellsWhere(v, OPEN)) {
    if (score[r][c] > best) { best = score[r][c]; cands = [[r, c]]; }
    else if (score[r][c] === best && best > 0) cands.push([r, c]);
  }
  return cands.length ? pick(cands, rng) : pick(cellsWhere(v, OPEN), rng);
}

/** Choose the computer's next target on `board` (the player's board). Returns [r, c]. */
export function aiShot(board, level = 'normal', rng = Math.random) {
  const v = viewOf(board);
  if (level === 'easy') return easyShot(v, rng);
  if (level === 'normal') return normalShot(v, rng);
  const remaining = board.ships.filter(s => !isSunk(board, s)).map(s => s.len);
  return hardShot(v, remaining, rng);
}
