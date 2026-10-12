import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cellsOf, mulberry32, randomFleet } from '../public/js/battleships.js';
import { newCode, Room, validFleet } from '../server/rooms.js';

const plain = ships => ships.map(({ r, c, vertical }) => ({ r, c, vertical }));

function readyRoom(opts = {}) {
  const room = new Room('TEST', { rng: () => 0, ...opts }); // rng 0 → seat 0 starts
  room.addPlayer('a');
  room.addPlayer('b');
  const fleets = [randomFleet(mulberry32(1)), randomFleet(mulberry32(2))];
  assert.equal(room.setFleet(0, plain(fleets[0])), null);
  assert.equal(room.phase, 'place');
  assert.equal(room.setFleet(1, plain(fleets[1])), null);
  return { room, fleets };
}

test('validFleet rejects bad input', () => {
  assert.equal(validFleet(null), null);
  assert.equal(validFleet([{ r: 0, c: 0 }]), null);
  const ok = plain(randomFleet(mulberry32(3)));
  assert.ok(validFleet(ok));
  const overlapping = ok.map(() => ({ r: 0, c: 0, vertical: false }));
  assert.equal(validFleet(overlapping), null);
  assert.equal(validFleet(ok.map((s, i) => (i ? s : { ...s, r: 1.5 }))), null);
});

test('validFleet only rejects touching ships with noTouch', () => {
  const touching = [
    { r: 0, c: 0, vertical: false },
    { r: 1, c: 0, vertical: false },
    { r: 2, c: 0, vertical: false },
    { r: 3, c: 0, vertical: false },
    { r: 4, c: 0, vertical: false },
  ];
  assert.ok(validFleet(touching));
  assert.equal(validFleet(touching, true), null);
});

test('newCode avoids taken codes', () => {
  const taken = new Map([['AAAA', 1]]);
  let n = 0;
  const rng = () => (n++ < 4 ? 0 : 0.5);
  assert.notEqual(newCode(taken, rng), 'AAAA');
});

test('turns alternate, hits keep the turn only with extraShot', () => {
  const { room, fleets } = readyRoom();
  assert.equal(room.phase, 'battle');
  assert.equal(room.turn, 0);
  assert.equal(room.fire(1, 0, 0), null, 'not your turn');
  const [r, c] = cellsOf(fleets[1][0])[0];
  assert.equal(room.fire(0, r, c).result, 'hit');
  assert.equal(room.turn, 1, 'no extra shot by default');

  const x = readyRoom({ extraShot: true });
  const [r2, c2] = cellsOf(x.fleets[1][0])[0];
  x.room.fire(0, r2, c2);
  assert.equal(x.room.turn, 0);
});

test('stateFor hides unsunk enemy ships and plain-hit ship names', () => {
  const { room, fleets } = readyRoom();
  const [r, c] = cellsOf(fleets[1][0])[0];
  room.fire(0, r, c);
  const s0 = room.stateFor(0);
  assert.deepEqual(s0.opp.ships, []);
  assert.equal(s0.last.ship, null);
  assert.equal(room.stateFor(1).last.ship, fleets[1][0].name, 'you know which of your ships was hit');
  assert.equal(JSON.stringify(s0).includes('"vertical"') && s0.opp.ships.length, 0);
});

test('game over, rematch and leaving', () => {
  const { room, fleets } = readyRoom({ extraShot: true });
  for (const s of fleets[1]) for (const [r, c] of cellsOf(s)) room.fire(0, r, c);
  assert.equal(room.phase, 'over');
  assert.equal(room.stateFor(0).winner, 'me');
  assert.equal(room.stateFor(1).opp.ships.length, 5, 'all ships revealed at the end');
  room.rematch(0);
  assert.equal(room.phase, 'over');
  room.rematch(1);
  assert.equal(room.phase, 'place');
  assert.equal(room.seats[0].board, null);

  const x = readyRoom();
  x.room.leave(1);
  assert.equal(x.room.phase, 'over');
  assert.equal(x.room.stateFor(0).winner, 'me');
  assert.ok(x.room.closed);
});

// ── End to end over a real WebSocket ──

function client(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const queue = [];
  const waiters = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    const w = waiters.findIndex(x => x.pred(m));
    if (w >= 0) {
      queue.length = 0; // anything older is stale
      waiters.splice(w, 1)[0].resolve(m);
    }
    else queue.push(m);
  };
  return {
    ws,
    open: new Promise(res => { ws.onopen = res; }),
    send: m => ws.send(JSON.stringify(m)),
    next(pred) {
      const i = queue.findIndex(pred);
      if (i >= 0) return Promise.resolve(queue.splice(0, i + 1)[i]); // drop older messages
      return new Promise(resolve => waiters.push({ pred, resolve }));
    },
  };
}

test('two players play a full online game', async t => {
  const port = 5600 + Math.floor(Math.random() * 300);
  const srv = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, PORT: port }, stdio: 'pipe' });
  t.after(() => srv.kill());
  await new Promise(res => srv.stdout.once('data', res));

  const a = client(port);
  const b = client(port);
  t.after(() => { a.ws.close(); b.ws.close(); });
  await Promise.all([a.open, b.open]);
  a.send({ t: 'create', name: 'Alice' });
  const { code, token } = await a.next(m => m.t === 'room');
  b.send({ t: 'join', code, name: 'Bob' });
  await b.next(m => m.t === 'room');

  const fleets = { a: randomFleet(mulberry32(10)), b: randomFleet(mulberry32(11)) };
  a.send({ t: 'fleet', ships: plain(fleets.a) });
  b.send({ t: 'fleet', ships: plain(fleets.b) });
  let sa = await a.next(m => m.t === 'state' && m.phase === 'battle');
  let sb = await b.next(m => m.t === 'state' && m.phase === 'battle');
  assert.equal(sa.opp.name, 'Bob');
  assert.notEqual(sa.myTurn, sb.myTurn);

  // Alice fires at Bob's ships, Bob only misses: a short game that stays under the rate limit.
  const aTargets = fleets.b.flatMap(cellsOf);
  const aCells = new Set(fleets.a.flatMap(cellsOf).map(String));
  for (let n = 0; n < 60 && sa.phase === 'battle'; n++) {
    if (sa.myTurn) {
      const [r, c] = aTargets.shift();
      a.send({ t: 'fire', r, c });
    } else {
      let k = 0;
      while (aCells.has(`${Math.floor(k / 10)},${k % 10}`) || sb.opp.shots[Math.floor(k / 10)][k % 10] !== 0) k++;
      b.send({ t: 'fire', r: Math.floor(k / 10), c: k % 10 });
    }
    sa = await a.next(m => m.t === 'state');
    sb = await b.next(m => m.t === 'state');
  }
  assert.equal(sa.phase, 'over');
  assert.equal(sa.winner, 'me');
  assert.notEqual(sa.winner, sb.winner);

  // Reconnect with the token gets the same seat back.
  a.ws.close();
  const a2 = client(port);
  t.after(() => a2.ws.close());
  await a2.open;
  a2.send({ t: 'join', code, token });
  await a2.next(m => m.t === 'room');
  const back = await a2.next(m => m.t === 'state');
  assert.equal(back.me.name, 'Alice');
  assert.equal(back.phase, 'over');
});
