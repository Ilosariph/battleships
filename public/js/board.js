// Board rendering. Cells are created once and only their classes change between renders.
import { cellsOf, HIT, MISS, SIZE, WATER } from './battleships.js';

export const LETTERS = 'ABCDEFGHIJ';
export const coord = (r, c) => `${LETTERS[c]}${r + 1}`;

/** A ship is sunk when every cell of it has been hit. */
export const sunkOn = (shots, ship) => !!shots && cellsOf(ship).every(([r, c]) => shots[r][c] === HIT);

export function buildBoard(wrap, { buttons = false } = {}) {
  const cols = document.createElement('div');
  cols.className = 'labels cols';
  const rows = document.createElement('div');
  rows.className = 'labels rows';
  for (let i = 0; i < SIZE; i++) {
    cols.insertAdjacentHTML('beforeend', `<span>${LETTERS[i]}</span>`);
    rows.insertAdjacentHTML('beforeend', `<span>${i + 1}</span>`);
  }
  const grid = document.createElement('div');
  grid.className = 'board';
  const cells = [];
  for (let r = 0; r < SIZE; r++) {
    const row = [];
    for (let c = 0; c < SIZE; c++) {
      const el = document.createElement(buttons ? 'button' : 'div');
      el.className = 'cell';
      el.dataset.r = r;
      el.dataset.c = c;
      if (buttons) {
        el.type = 'button';
        el.tabIndex = -1;
        el.setAttribute('aria-label', coord(r, c));
      }
      grid.append(el);
      row.push(el);
    }
    cells.push(row);
  }
  const corner = document.createElement('div');
  corner.className = 'corner';
  wrap.replaceChildren(corner, cols, rows, grid);
  return { grid, cells, cls: cells.map(row => row.map(() => '')) };
}

/** Board cell [r, c] under a client point, or null. */
export function cellAt(view, x, y) {
  const rect = view.grid.getBoundingClientRect();
  const r = Math.floor(((y - rect.top) / rect.height) * SIZE);
  const c = Math.floor(((x - rect.left) / rect.width) * SIZE);
  return r >= 0 && c >= 0 && r < SIZE && c < SIZE ? [r, c] : null;
}

/**
 * ships: [{ r, c, len, vertical, sunk?, lifted?, revealed? }]
 * ghost: ship being dragged ({ ...ship, ok }) or null
 * targetable: unknown cells get the `target` class
 * last: { r, c } of the latest shot on this board
 */
export function paint(view, { shots = null, ships = [], ghost = null, targetable = false, last = null } = {}) {
  const cls = Array.from({ length: SIZE }, () => Array.from({ length: SIZE }, () => ['cell']));
  const shipClasses = (s, extra) => {
    const cells = cellsOf(s);
    cells.forEach(([r, c], k) => {
      if (!cls[r]?.[c]) return;
      cls[r][c].push(...extra, s.vertical ? 'v' : 'h');
      if (k === 0) cls[r][c].push('bow');
      if (k === cells.length - 1) cls[r][c].push('stern');
    });
  };
  for (const s of ships) {
    shipClasses(s, ['ship', ...(s.sunk ? ['sunk'] : []), ...(s.lifted ? ['lifted'] : []), ...(s.revealed ? ['revealed'] : [])]);
  }
  if (ghost) shipClasses(ghost, ['ghost', ghost.ok ? 'ok' : 'bad']);
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const s = shots?.[r][c];
      if (s === MISS) cls[r][c].push('miss');
      else if (s === HIT) cls[r][c].push('hit');
      else if (s === WATER) cls[r][c].push('water');
      else if (targetable) cls[r][c].push('target');
    }
  }
  if (last) cls[last.r][last.c].push('last');

  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const name = cls[r][c].join(' ');
      if (view.cls[r][c] !== name) {
        view.cells[r][c].className = name;
        view.cls[r][c] = name;
      }
    }
  }
}

/** Fleet list with one pip per ship cell; `hits[i]` filled pips, `sunk[i]` strikes it through. */
export function paintTracker(ul, fleet, { sunk = [], hits = null } = {}) {
  ul.innerHTML = fleet.map((f, i) => {
    const pips = Array.from({ length: f.len }, (_, k) => `<i${hits && k < hits[i] ? ' class="h"' : ''}></i>`).join('');
    return `<li class="${sunk[i] ? 'sunk' : ''}"><span>${f.name}</span><b>${pips}</b></li>`;
  }).join('');
}
