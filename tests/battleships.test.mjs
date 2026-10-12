import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiShot, allSunk, canPlace, cellsOf, fire, FLEET, HIT, isSunk, LEVELS, MISS, mulberry32,
  newBoard, randomFleet, SIZE, UNKNOWN, WATER,
} from '../public/js/battleships.js';

const fixed = [
  { name: 'Carrier', len: 5, r: 0, c: 0, vertical: false },
  { name: 'Battleship', len: 4, r: 2, c: 0, vertical: true },
  { name: 'Cruiser', len: 3, r: 9, c: 7, vertical: false },
  { name: 'Submarine', len: 3, r: 4, c: 5, vertical: true },
  { name: 'Destroyer', len: 2, r: 0, c: 8, vertical: false },
];

test('random fleets are complete, in bounds and never touch', () => {
  for (let seed = 0; seed < 300; seed++) {
    const ships = randomFleet(mulberry32(seed));
    assert.deepEqual(ships.map(s => s.len), FLEET.map(f => f.len));
    ships.forEach((s, i) => assert.ok(canPlace(ships, s, SIZE, i), `seed ${seed} ship ${i}`));
  }
});

test('canPlace rejects out of bounds and touching ships', () => {
  assert.ok(canPlace(fixed, { len: 2, r: 7, c: 0, vertical: false }));
  assert.ok(!canPlace(fixed, { len: 2, r: 9, c: 9, vertical: false }));
  assert.ok(!canPlace(fixed, { len: 2, r: 1, c: 5, vertical: false })); // diagonal to carrier
  assert.ok(!canPlace(fixed, { len: 2, r: 6, c: 1, vertical: false })); // below battleship
});

test('fire: miss, hit, sunk and deduced water', () => {
  const b = newBoard(fixed);
  assert.equal(fire(b, 5, 9).result, 'miss');
  assert.equal(b.shots[5][9], MISS);
  assert.equal(fire(b, 5, 9), null, 'same cell twice');

  const hit = fire(b, 0, 8);
  assert.equal(hit.result, 'hit');
  assert.deepEqual(hit.marks, [[1, 7], [1, 9]]);
  assert.equal(b.shots[1][9], WATER);
  assert.equal(fire(b, 1, 9), null, 'water cells cannot be targeted');

  const sunk = fire(b, 0, 9);
  assert.equal(sunk.result, 'sunk');
  assert.equal(b.ships[sunk.ship].name, 'Destroyer');
  assert.ok(isSunk(b, b.ships[4]));
  assert.equal(b.shots[0][7], WATER);
  assert.equal(b.shots[1][8], WATER);
});

test('allSunk after every ship cell is hit', () => {
  const b = newBoard(fixed);
  for (const s of b.ships) for (const [r, c] of cellsOf(s)) fire(b, r, c);
  assert.ok(allSunk(b));
  for (const row of b.shots) for (const x of row) assert.ok([HIT, WATER, UNKNOWN].includes(x));
});

function playOut(level, seed) {
  const rng = mulberry32(seed);
  const b = newBoard(randomFleet(rng));
  let shots = 0;
  while (!allSunk(b)) {
    const [r, c] = aiShot(b, level, rng);
    assert.ok(fire(b, r, c), `${level} picked an invalid cell`);
    assert.ok(++shots <= 100);
  }
  return shots;
}

test('every AI level only picks valid cells and finishes the game', () => {
  for (const level of LEVELS) for (let seed = 0; seed < 25; seed++) playOut(level, seed);
});

test('harder levels need fewer shots on average', () => {
  const avg = level => {
    let total = 0;
    for (let seed = 0; seed < 60; seed++) total += playOut(level, 1000 + seed);
    return total / 60;
  };
  const [easy, normal, hard] = LEVELS.map(avg);
  assert.ok(easy > normal, `easy ${easy} vs normal ${normal}`);
  assert.ok(normal > hard, `normal ${normal} vs hard ${hard}`);
});
