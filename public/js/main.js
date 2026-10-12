import {
  aiShot, allSunk, canPlace, cellsOf, emptyGrid, fire, FLEET, HIT, isSunk, LEVELS, MISS, newBoard, randomFleet,
  SIZE, UNKNOWN,
} from './battleships.js';
import { buildBoard, cellAt, coord, paint, paintTracker, sunkOn } from './board.js';

const $ = s => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } },
};
// Per-tab copy of the online seat, so a second tab opening an invite link joins as the other player.
const tabSeat = {
  get() { try { return JSON.parse(sessionStorage.getItem('bs-online')); } catch { return null; } },
  set(v) { try { sessionStorage.setItem('bs-online', JSON.stringify(v)); } catch { /* storage unavailable */ } },
  del() { try { sessionStorage.removeItem('bs-online'); } catch { /* storage unavailable */ } },
};
const esc = s => String(s).replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
const LEVEL_NAME = { easy: 'Easy', normal: 'Normal', hard: 'Hard' };
const AI_DELAY = 700;

// ── Dark mode (defaults to the system setting) ──
const darkToggle = $('#darkToggle');
function applyDark(on) {
  document.documentElement.classList.toggle('dark', on);
  darkToggle.textContent = on ? '☀' : '☾';
}
applyDark(store.get('dark', matchMedia('(prefers-color-scheme: dark)').matches));
darkToggle.addEventListener('click', () => {
  const on = !document.documentElement.classList.contains('dark');
  applyDark(on);
  store.set('dark', on);
});

// ── State ──
const settings = { level: 'normal', extraShot: false, name: '', ...store.get('bs-settings', {}) };
const saveSettings = () => store.set('bs-settings', settings);

let mode = null; // null = menu, 'ai' | 'online'
let game = store.get('bs-game', null); // vs-computer game (persisted)
let online = null; // { ws, code, token, intent, state, connected, retry, firing }
let placing = null; // ships being arranged on the placement screen
let drag = null; // { i, offset, x, y, moved, ghost }
let hover = null; // [r, c] under the pointer on my board
let cursor = [0, 0]; // keyboard focus on enemy waters
let overDismissed = false;
let confirmAct = null; // action waiting for a second click
let aiTimer = null;

const enemyView = buildBoard($('#enemyBoard'), { buttons: true });
const myView = buildBoard($('#myBoard'));

// ── Shared view model for both modes ──

function vm() {
  if (mode === 'ai') {
    const g = game;
    const over = g.phase === 'over';
    return {
      phase: g.phase,
      editable: g.phase === 'place',
      myBoard: g.player,
      myShips: g.phase === 'place' ? placing : g.player.ships,
      oppShots: g.enemy?.shots ?? emptyGrid(SIZE),
      oppShips: (g.enemy?.ships ?? []).filter(s => over || isSunk(g.enemy, s)),
      oppSunk: g.enemy ? g.enemy.ships.map(s => isSunk(g.enemy, s)) : FLEET.map(() => false),
      myTurn: g.phase === 'battle' && g.turn === 'me',
      last: g.last,
      winner: g.winner,
      oppName: 'The computer',
    };
  }
  const s = online.state;
  if (!s) return { phase: 'connecting', editable: false, myShips: [], oppShots: emptyGrid(SIZE), oppShips: [], oppSunk: [] };
  const oppShots = s.opp?.shots ?? emptyGrid(SIZE);
  return {
    phase: s.phase,
    editable: s.phase === 'place' && !s.me.ready && !s.closed,
    myBoard: s.me.board,
    myShips: s.phase === 'place' && !s.me.ready ? placing : s.me.board?.ships ?? [],
    oppShots,
    oppShips: s.opp?.ships ?? [],
    oppSunk: s.opp?.sunk ?? FLEET.map(() => false),
    myTurn: s.myTurn && !online.firing,
    last: s.last,
    winner: s.winner,
    oppName: s.opp?.name ?? 'Opponent',
  };
}

// ── Rendering ──

function render() {
  $('#menu').hidden = !!mode;
  $('#game').hidden = !mode;
  if (!mode) {
    $('#modeBadge').hidden = true;
    renderMenu();
    return;
  }
  const v = vm();
  document.body.dataset.phase = v.phase;
  $('#modeBadge').hidden = false;
  $('#modeBadge').textContent = mode === 'ai' ? `vs Computer · ${LEVEL_NAME[game.level]}` : 'Online';
  renderBoards(v);
  renderStatus(v);
  renderRoomBar();
  renderActions(v);
  renderModal(v);
}

function renderBoards(v = vm()) {
  const placingNow = v.editable;
  const myShips = v.myShips.map((s, i) => ({
    ...s,
    sunk: !placingNow && v.myBoard && isSunk(v.myBoard, s),
    lifted: placingNow && drag?.moved && drag.i === i,
  }));
  paint(myView, {
    shots: placingNow ? null : v.myBoard?.shots,
    ships: myShips,
    ghost: placingNow && drag?.moved ? drag.ghost : null,
    last: v.last?.by === 'opp' ? v.last : null,
  });
  $('#enemySide').hidden = v.phase === 'place' || v.phase === 'connecting';
  $('#placeHint').hidden = !placingNow;
  $('#myTracker').hidden = v.phase === 'place';
  paint(enemyView, {
    shots: v.oppShots,
    ships: v.oppShips.map(s => {
      const sunk = sunkOn(v.oppShots, s);
      return { ...s, sunk, revealed: !sunk };
    }),
    targetable: v.myTurn,
    last: v.last?.by === 'me' ? v.last : null,
  });
  enemyView.cells.flat().forEach(el => { el.tabIndex = -1; });
  enemyView.cells[cursor[0]][cursor[1]].tabIndex = 0;
  document.body.classList.toggle('my-turn', !!v.myTurn);

  paintTracker($('#enemyTracker'), FLEET, { sunk: v.oppSunk });
  if (v.myBoard) {
    const b = v.myBoard;
    paintTracker($('#myTracker'), FLEET, {
      sunk: b.ships.map(s => isSunk(b, s)),
      hits: b.ships.map(s => cellsOf(s).filter(([r, c]) => b.shots[r][c] === HIT).length),
    });
  }
}

function lastText(v) {
  const l = v.last;
  if (!l) return '';
  const at = coord(l.r, l.c);
  if (l.by === 'me') {
    if (l.result === 'miss') return `${at}: miss.`;
    if (l.result === 'hit') return `${at}: hit!`;
    return `${at}: you sank the ${l.ship}!`;
  }
  if (l.result === 'miss') return `${v.oppName} missed at ${at}.`;
  if (l.result === 'hit') return `${v.oppName} hit your ${l.ship} at ${at}.`;
  return `${v.oppName} sank your ${l.ship}!`;
}

function renderStatus(v) {
  let event = '';
  let turn = '';
  const s = mode === 'online' ? online.state : null;
  if (v.phase === 'connecting') {
    turn = online.intent?.t === 'quick' ? 'Looking for an opponent…' : 'Connecting…';
  } else if (v.phase === 'place') {
    if (mode === 'ai') {
      event = 'Position your fleet.';
      turn = 'Start the battle when you are ready.';
    } else if (!s.opp) {
      event = online.quick ? 'Looking for an opponent…' : 'Waiting for your opponent to join.';
      turn = online.quick ? 'Position your fleet meanwhile.' : 'Send them the invite link. Position your fleet meanwhile.';
    } else if (!s.me.ready) {
      event = `Playing against ${s.opp.name}. Position your fleet.`;
      turn = s.opp.ready ? `${s.opp.name} is ready.` : `${s.opp.name} is placing ships.`;
    } else {
      event = 'Fleet locked in.';
      turn = `Waiting for ${s.opp.name}…`;
    }
  } else {
    event = lastText(v) || (v.myTurn ? 'You go first.' : `${v.oppName} goes first.`);
    if (v.phase === 'over') {
      turn = s?.opp?.left && v.winner === 'me' ? `${v.oppName} left the game. You win!`
        : v.winner === 'me' ? 'Victory! The enemy fleet is gone.' : 'Defeat. Your fleet has been sunk.';
    } else if (s && !s.opp?.connected) {
      turn = `${v.oppName} disconnected. Waiting for them to come back…`;
    } else if (v.myTurn || (mode === 'online' && s.myTurn)) {
      turn = v.last?.by === 'me' && v.last.result !== 'miss' ? 'Fire again!' : 'Your turn: fire at enemy waters.';
    } else {
      turn = `${v.oppName} is aiming…`;
    }
  }
  if (mode === 'online' && !online.connected && v.phase !== 'connecting') turn = 'Connection lost. Reconnecting…';
  $('#statusEvent').textContent = event;
  $('#statusTurn').textContent = turn;
  $('#status').classList.toggle('alert', v.phase === 'battle' && !!v.myTurn);
}

function renderRoomBar() {
  const show = mode === 'online' && !!online.code && !online.quick;
  $('#roomBar').hidden = !show;
  if (!show) return;
  $('#roomCode').textContent = online.code;
  const opp = online.state?.opp;
  $('#oppStatus').textContent = !opp ? 'waiting for opponent' : opp.left ? `${opp.name} left` : opp.connected ? `${opp.name} online` : `${opp.name} offline`;
  $('#oppStatus').className = `opp-status ${opp?.connected && !opp.left ? 'on' : ''}`;
  $('#copyLink').hidden = !!opp;
}

function renderActions(v) {
  const btns = [];
  const add = (act, label, accent = false, disabled = false) => {
    const confirming = confirmAct === act;
    btns.push(`<button data-act="${act}" class="${accent || confirming ? 'btn-accent' : ''}"${disabled ? ' disabled' : ''}>${confirming ? 'Sure? Click again' : label}</button>`);
  };
  const s = online?.state;
  if (v.phase === 'place') {
    if (v.editable) {
      add('shuffle', 'Shuffle');
      add('ready', mode === 'ai' ? 'Start battle' : 'Ready', true);
    } else if (mode === 'online' && !s.closed) {
      add('unready', 'Edit fleet');
    }
    if (mode === 'online') add('leave', 'Leave room');
  } else if (v.phase === 'battle') {
    add(mode === 'ai' ? 'resign' : 'leave', mode === 'ai' ? 'Resign' : 'Leave game');
  } else if (v.phase === 'over') {
    if (mode === 'ai') add('again', 'Play again', true);
    else if (!s.closed) add('rematch', s.me.rematch ? 'Rematch requested…' : s.opp?.rematch ? 'Accept rematch' : 'Rematch', true, s.me.rematch);
    add('menu', 'Menu');
  } else if (v.phase === 'connecting') {
    add('leave', 'Cancel');
  }
  $('#actions').innerHTML = btns.join('');
}

function renderModal(v) {
  const show = v.phase === 'over' && !overDismissed;
  $('#overModal').hidden = !show;
  if (!show) return;
  const won = v.winner === 'me';
  $('#overTitle').textContent = won ? 'Victory!' : 'Defeat';
  $('#overTitle').className = `modal-title ${won ? 'won' : 'lost'}`;
  let shots;
  let hits;
  if (mode === 'ai') {
    shots = game.shots.me;
    hits = game.hits.me;
  } else {
    const flat = v.oppShots.flat();
    shots = flat.filter(x => x === MISS || x === HIT).length;
    hits = flat.filter(x => x === HIT).length;
  }
  const lines = [`${shots} shots · ${shots ? Math.round((hits / shots) * 100) : 0}% accuracy`];
  if (mode === 'ai') lines.push(recordText(game.level));
  else if (online.state.opp?.left) lines.push(`${esc(v.oppName)} left the game.`);
  else if (online.state.opp?.rematch && !online.state.me.rematch) lines.push(`${esc(v.oppName)} wants a rematch.`);
  $('#overSub').innerHTML = lines.join('<br>');
  const closed = mode === 'online' && online.state.closed;
  $('#againBtn').textContent = mode === 'ai' ? 'Play again' : closed ? 'Menu' : online.state.me.rematch ? 'Waiting…' : 'Rematch';
  $('#againBtn').disabled = mode === 'online' && !closed && online.state.me.rematch;
}

function recordText(level) {
  const r = store.get('bs-stats', {})[level];
  if (!r) return `No games vs ${LEVEL_NAME[level]} yet.`;
  return `Record vs ${LEVEL_NAME[level]}: ${r.w}W – ${r.l}L${r.best ? ` · best win ${r.best} shots` : ''}`;
}

function renderMenu() {
  document.body.dataset.phase = 'menu';
  document.querySelectorAll('#levelSeg button').forEach(b => {
    const on = b.dataset.level === settings.level;
    b.classList.toggle('active', on);
    b.setAttribute('aria-checked', on);
  });
  $('#extraShot').checked = settings.extraShot;
  if (document.activeElement !== $('#nameInput')) $('#nameInput').value = settings.name;
  $('#record').textContent = recordText(settings.level);
  const resume = [];
  if (game && game.phase !== 'over') resume.push(`<button class="btn-accent wide" data-resume="ai">Continue vs Computer (${LEVEL_NAME[game.level]})</button>`);
  if (online) resume.push(`<button class="btn-accent wide" data-resume="online">Back to online game${online.code ? ` · ${online.code}` : ''}</button>`);
  else {
    const saved = store.get('bs-online', null);
    if (saved) resume.push(`<button class="wide" data-resume="rejoin">Rejoin room ${esc(saved.code)}</button>`);
  }
  $('#resume').innerHTML = resume.join('');
}

// ── Placement ──

function shuffle() {
  placing = randomFleet();
  savePlacing();
  render();
}

function savePlacing() {
  if (mode === 'ai') {
    game.ships = placing;
    saveGame();
  }
}

function rotate(i, offset) {
  const s = placing[i];
  const [pr, pc] = cellsOf(s)[offset];
  const vertical = !s.vertical;
  const tries = [];
  for (const shift of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
    const o = offset + shift;
    if (o < 0 || o >= s.len) continue;
    tries.push(vertical ? { ...s, vertical, r: pr - o, c: pc } : { ...s, vertical, r: pr, c: pc - o });
  }
  const ok = tries.find(t => canPlace(placing, t, SIZE, i));
  if (ok) {
    placing[i] = ok;
    savePlacing();
  } else {
    myView.grid.classList.remove('shake');
    void myView.grid.offsetWidth;
    myView.grid.classList.add('shake');
  }
  render();
}

const shipIndexAt = (r, c) => placing.findIndex(s => cellsOf(s).some(([sr, sc]) => sr === r && sc === c));

myView.grid.addEventListener('pointerdown', e => {
  if (!mode || !vm().editable) return;
  const at = cellAt(myView, e.clientX, e.clientY);
  if (!at) return;
  const i = shipIndexAt(...at);
  if (i < 0) return;
  e.preventDefault();
  const s = placing[i];
  drag = { i, offset: s.vertical ? at[0] - s.r : at[1] - s.c, x: e.clientX, y: e.clientY, moved: false, ghost: null };
  myView.grid.setPointerCapture(e.pointerId);
});

myView.grid.addEventListener('pointermove', e => {
  hover = cellAt(myView, e.clientX, e.clientY);
  if (!drag) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
  drag.moved = true;
  const s = placing[drag.i];
  const g = hover && { ...s, r: s.vertical ? hover[0] - drag.offset : hover[0], c: s.vertical ? hover[1] : hover[1] - drag.offset };
  const key = g ? `${g.r},${g.c}` : '';
  if (drag.key === key && drag.ghost) return;
  drag.key = key;
  drag.ghost = g && { ...g, ok: canPlace(placing, g, SIZE, drag.i) };
  renderBoards();
});

myView.grid.addEventListener('pointerup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (!d.moved) return rotate(d.i, d.offset);
  if (d.ghost?.ok) {
    const { ok, ...ship } = d.ghost;
    placing[d.i] = ship;
    savePlacing();
  }
  render();
});

myView.grid.addEventListener('pointercancel', () => { drag = null; renderBoards(); });
myView.grid.addEventListener('pointerleave', () => { if (!drag) hover = null; });

document.addEventListener('keydown', e => {
  if ((e.key === 'r' || e.key === 'R') && mode && hover && vm().editable && !e.target.closest('input')) {
    const i = shipIndexAt(...hover);
    if (i >= 0) {
      const s = placing[i];
      rotate(i, s.vertical ? hover[0] - s.r : hover[1] - s.c);
    }
  }
});

// ── Firing ──

enemyView.grid.addEventListener('click', e => {
  const el = e.target.closest('.cell');
  if (!el) return;
  cursor = [+el.dataset.r, +el.dataset.c];
  playerFire(...cursor);
});

enemyView.grid.addEventListener('keydown', e => {
  const d = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
  if (!d) return;
  e.preventDefault();
  cursor = [Math.min(SIZE - 1, Math.max(0, cursor[0] + d[0])), Math.min(SIZE - 1, Math.max(0, cursor[1] + d[1]))];
  enemyView.cells.flat().forEach(el => { el.tabIndex = -1; });
  const el = enemyView.cells[cursor[0]][cursor[1]];
  el.tabIndex = 0;
  el.focus();
});

function playerFire(r, c) {
  const v = vm();
  if (!v.myTurn || v.oppShots[r][c] !== UNKNOWN) return;
  confirmAct = null;
  if (mode === 'online') {
    online.firing = true;
    send({ t: 'fire', r, c });
    render();
    return;
  }
  const res = fire(game.enemy, r, c);
  if (!res) return;
  record('me', r, c, res, game.enemy);
  if (allSunk(game.enemy)) finish('me');
  else if (res.result === 'miss' || !game.extraShot) {
    game.turn = 'opp';
    scheduleAi();
  }
  saveGame();
  render();
}

// ── vs Computer ──

function saveGame() {
  if (game) store.set('bs-game', game);
}

function record(by, r, c, res, board) {
  game.shots[by]++;
  if (res.result !== 'miss') game.hits[by]++;
  game.last = { by, r, c, result: res.result, ship: res.ship >= 0 && (by === 'opp' || res.result === 'sunk') ? board.ships[res.ship].name : null };
}

function startAi() {
  clearTimeout(aiTimer);
  game = {
    level: settings.level,
    extraShot: settings.extraShot,
    phase: 'place',
    ships: randomFleet(),
    player: null,
    enemy: null,
    turn: 'me',
    shots: { me: 0, opp: 0 },
    hits: { me: 0, opp: 0 },
    last: null,
    winner: null,
  };
  placing = game.ships;
  overDismissed = false;
  mode = 'ai';
  saveGame();
  render();
}

function resumeAi() {
  mode = 'ai';
  overDismissed = false;
  if (game.phase === 'place') placing = game.ships;
  if (game.phase === 'battle' && game.turn === 'opp') scheduleAi();
  render();
}

function beginBattle() {
  game.player = newBoard(placing);
  game.enemy = newBoard(randomFleet());
  game.phase = 'battle';
  game.turn = Math.random() < 0.5 ? 'me' : 'opp';
  if (game.turn === 'opp') scheduleAi();
  saveGame();
  render();
}

function scheduleAi() {
  clearTimeout(aiTimer);
  aiTimer = setTimeout(aiMove, AI_DELAY);
}

function aiMove() {
  if (!game || game.phase !== 'battle' || game.turn !== 'opp') return;
  const [r, c] = aiShot(game.player, game.level);
  const res = fire(game.player, r, c);
  record('opp', r, c, res, game.player);
  if (allSunk(game.player)) finish('opp');
  else if (res.result === 'miss' || !game.extraShot) game.turn = 'me';
  else scheduleAi();
  saveGame();
  if (mode === 'ai') render();
}

function finish(winner) {
  game.phase = 'over';
  game.winner = winner;
  const stats = store.get('bs-stats', {});
  const r = stats[game.level] ?? { w: 0, l: 0, best: 0 };
  if (winner === 'me') {
    r.w++;
    r.best = r.best ? Math.min(r.best, game.shots.me) : game.shots.me;
    confetti();
  } else {
    r.l++;
  }
  stats[game.level] = r;
  store.set('bs-stats', stats);
  overDismissed = false;
}

// ── Online ──

const wsUrl = () => `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

function send(msg) {
  if (online?.ws?.readyState === WebSocket.OPEN) online.ws.send(JSON.stringify(msg));
}

function startOnline(intent) {
  if (online) leaveOnline(false);
  online = { ws: null, code: null, token: null, intent, state: null, connected: false, retry: 0, firing: false, quick: intent.t === 'quick' };
  mode = 'online';
  overDismissed = false;
  $('#onlineErr').hidden = true;
  connect();
  render();
}

function connect() {
  if (!online || (online.ws && online.ws.readyState <= WebSocket.OPEN)) return;
  const ws = new WebSocket(wsUrl());
  online.ws = ws;
  ws.onopen = () => {
    online.connected = true;
    online.retry = 0;
    if (online.code && online.token) send({ t: 'join', code: online.code, token: online.token });
    else if (online.intent) send(online.intent);
    render();
  };
  ws.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    onServer(m);
  };
  ws.onclose = () => {
    if (!online || online.ws !== ws) return;
    online.ws = null;
    online.connected = false;
    online.firing = false;
    setTimeout(connect, Math.min(8000, 500 * 2 ** online.retry++));
    if (mode === 'online') render();
  };
}

function onServer(m) {
  if (!online) return;
  if (m.t === 'room') {
    online.code = m.code;
    online.token = m.token;
    online.intent = null;
    store.set('bs-online', { code: m.code, token: m.token });
    tabSeat.set({ code: m.code, token: m.token });
    history.replaceState(null, '', `?room=${m.code}`);
  } else if (m.t === 'state') {
    const prev = online.state;
    online.state = m;
    online.firing = false;
    if (m.phase === 'place' && (!prev || prev.phase !== 'place' || (prev.me.ready && !m.me.ready) || !placing)) {
      placing = m.me.board ? m.me.board.ships.map(s => ({ ...s })) : (prev?.phase === 'place' && placing) || randomFleet();
    }
    if (m.phase === 'over' && prev?.phase !== 'over') {
      overDismissed = false;
      if (m.winner === 'me') confetti();
    }
    if (m.phase !== prev?.phase) confirmAct = null;
  } else if (m.t === 'error') {
    if (m.gone || m.fatal) {
      const msg = m.msg;
      leaveOnline(!m.fatal);
      showOnlineError(msg);
      return;
    }
    toast(m.msg);
  }
  if (mode === 'online') render();
}

function leaveOnline(notify = true) {
  if (!online) return;
  if (notify) send({ t: 'leave' });
  const ws = online.ws;
  online = null;
  ws?.close();
  store.del('bs-online');
  tabSeat.del();
  if (location.search) history.replaceState(null, '', location.pathname);
  if (mode === 'online') mode = null;
}

function showOnlineError(msg) {
  mode = null;
  render();
  $('#onlineErr').textContent = msg;
  $('#onlineErr').hidden = false;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && online && !online.ws) connect();
});

// ── Actions ──

function act(a) {
  if (['resign', 'leave'].includes(a) && confirmAct !== a && !(a === 'leave' && vm().phase !== 'battle')) {
    confirmAct = a;
    render();
    return;
  }
  confirmAct = null;
  switch (a) {
    case 'shuffle': shuffle(); return;
    case 'ready':
      if (mode === 'ai') beginBattle();
      else send({ t: 'fleet', ships: placing.map(({ r, c, vertical }) => ({ r, c, vertical })) });
      return;
    case 'unready': send({ t: 'unready' }); return;
    case 'resign':
      clearTimeout(aiTimer);
      finish('opp');
      saveGame();
      break;
    case 'leave': leaveOnline(); mode = null; break;
    case 'again': startAi(); return;
    case 'rematch': send({ t: 'rematch' }); break;
    case 'menu':
      if (mode === 'online' && online?.state?.phase === 'over') leaveOnline();
      mode = null;
      break;
  }
  render();
}

$('#actions').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]');
  if (b) act(b.dataset.act);
});

document.addEventListener('click', e => {
  if (confirmAct && !e.target.closest('#actions')) {
    confirmAct = null;
    if (mode) renderActions(vm());
  }
}, true);

$('#againBtn').addEventListener('click', () => {
  if (mode === 'ai') return startAi();
  if (online.state.closed) return act('menu');
  act('rematch');
});
$('#viewBtn').addEventListener('click', () => { overDismissed = true; render(); });
$('#overModal').addEventListener('click', e => {
  if (e.target === e.currentTarget) { overDismissed = true; render(); }
});

$('#homeBtn').addEventListener('click', () => {
  drag = null;
  confirmAct = null;
  mode = null;
  render();
});

// Menu
$('#levelSeg').addEventListener('click', e => {
  const b = e.target.closest('button[data-level]');
  if (!b || !LEVELS.includes(b.dataset.level)) return;
  settings.level = b.dataset.level;
  saveSettings();
  renderMenu();
});
$('#extraShot').addEventListener('change', e => { settings.extraShot = e.target.checked; saveSettings(); });
$('#nameInput').addEventListener('input', e => { settings.name = e.target.value.trim().slice(0, 16); saveSettings(); });
$('#aiBtn').addEventListener('click', startAi);
$('#createBtn').addEventListener('click', () => startOnline({ t: 'create', name: settings.name, extraShot: settings.extraShot }));
$('#quickBtn').addEventListener('click', () => startOnline({ t: 'quick', name: settings.name }));
$('#codeInput').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('#joinForm').addEventListener('submit', e => {
  e.preventDefault();
  const code = $('#codeInput').value.trim().toUpperCase();
  if (code.length !== 4) {
    showOnlineError('Room codes have 4 characters.');
    return;
  }
  joinRoom(code);
});
$('#resume').addEventListener('click', e => {
  const b = e.target.closest('button[data-resume]');
  if (!b) return;
  if (b.dataset.resume === 'ai') resumeAi();
  else if (b.dataset.resume === 'online') { mode = 'online'; overDismissed = false; render(); }
  else {
    const saved = store.get('bs-online', null);
    if (saved) joinRoom(saved.code, saved);
  }
});

function joinRoom(code, saved = tabSeat.get()) {
  startOnline({ t: 'join', code, name: settings.name });
  if (saved?.code === code) {
    online.code = saved.code;
    online.token = saved.token;
  }
}

$('#copyLink').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${online.code}`;
  try {
    await navigator.clipboard.writeText(url);
    toast('Invite link copied');
  } catch {
    toast(url);
  }
});

let toastTimer = null;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ── Confetti ──

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = $('#confetti');
  const ctx = cv.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ['#c45d3e', '#2a7f9e', '#e8b04a', '#5b7ab8', '#3f9a6b'];
  const parts = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 120,
    y: innerHeight * 0.35,
    vx: (Math.random() - 0.5) * 14,
    vy: -Math.random() * 13 - 4,
    w: 5 + Math.random() * 6,
    h: 3 + Math.random() * 4,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.3,
    color: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const p of parts) {
      p.vy += 0.35;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.a += p.va;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (t - start < 3500) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(start);
}

// ── Boot ──

const params = new URLSearchParams(location.search);
const roomParam = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (roomParam.length === 4) {
  joinRoom(roomParam);
} else {
  render();
}
