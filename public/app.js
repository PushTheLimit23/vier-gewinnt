// Vier Gewinnt – Client
(() => {
  const ROWS = 6, COLS = 7;
  const $ = (id) => document.getElementById(id);

  // ---------- Kleiner, fehlertoleranter Speicher ----------
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const rand = (n) => {
    const a = 'abcdefghijkmnpqrstuvwxyz23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    return Array.from(bytes, (b) => a[b % a.length]).join('');
  };
  let clientId = store.get('vg-client');
  if (!clientId) { clientId = rand(16); store.set('vg-client', clientId); }

  // Farbauswahl
  const PALETTE = [
    { c: '#41459e', n: 'Lila' },
    { c: '#56bca6', n: 'Türkis' },
    { c: '#479dcc', n: 'Blau' },
    { c: '#c75c48', n: 'Rot' },
    { c: '#f2c35b', n: 'Gelb' },
  ];
  let myColor = store.get('vg-color');
  if (!PALETTE.some((p) => p.c === myColor)) myColor = PALETTE[0].c;

  // Zeichnet die Farbkreise; "taken" = Farbe des Mitspielers (nicht wählbar)
  function renderSwatches(el, selected, taken, onPick) {
    el.innerHTML = '';
    for (const p of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.style.background = p.c;
      b.title = p.n + (p.c === taken ? ' (vergeben)' : '');
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(p.c === selected));
      b.disabled = p.c === taken;
      b.addEventListener('click', () => onPick(p.c));
      el.append(b);
    }
  }
  function swatchPicker(el) {
    const draw = () => renderSwatches(el, myColor, null, (c) => {
      myColor = c; store.set('vg-color', c); draw();
    });
    draw();
  }

  function show(view) {
    for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== view;
  }

  // ---------- Routing ----------
  const match = location.pathname.match(/^\/r\/([a-z0-9]{4,32})\/?$/i);
  if (!match) return initHome();
  const roomId = match[1].toLowerCase();
  const name = store.get('vg-name');
  if (name) startGame(roomId, name);
  else initNamePrompt(roomId);

  // ---------- Startseite ----------
  function initHome() {
    show('home');
    const input = $('home-name');
    input.value = store.get('vg-name') || '';
    swatchPicker($('home-colors'));
    $('home-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = input.value.trim();
      if (!n) return;
      store.set('vg-name', n);
      location.href = '/r/' + rand(8);
    });
    loadHistory();
  }

  async function loadHistory() {
    const list = $('history');
    try {
      const res = await fetch('/api/history?client=' + encodeURIComponent(clientId));
      const games = await res.json();
      if (!games.length) {
        list.innerHTML = '<li class="muted">Noch keine Spiele.</li>';
        return;
      }
      list.innerHTML = '';
      for (const g of games) {
        const li = document.createElement('li');
        const opp = g.players[1 - g.you] || '?';
        const date = new Date(g.ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
        const left = document.createElement('span');
        left.textContent = `gegen ${opp} · ${date}`;
        const right = document.createElement('span');
        right.className = 'res';
        if (g.winner === null) { right.textContent = 'Unentschieden'; }
        else if (g.winner === g.you) { right.textContent = 'Gewonnen'; right.classList.add('win'); }
        else { right.textContent = 'Verloren'; right.classList.add('loss'); }
        li.append(left, right);
        list.append(li);
      }
    } catch {
      list.innerHTML = '<li class="muted">Historie konnte nicht geladen werden.</li>';
    }
  }

  // ---------- Name abfragen ----------
  function initNamePrompt(room) {
    show('name');
    swatchPicker($('name-colors'));
    $('name-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = $('name-input').value.trim();
      if (!n) return;
      store.set('vg-name', n);
      startGame(room, n);
    });
    $('name-input').focus();
  }

  // ---------- Spiel ----------
  function startGame(room, myName) {
    show('game');
    const boardEl = $('board');
    const previewEl = $('preview');
    const cells = [];
    const ghosts = [];
    let state = null;
    let ws = null;
    let retry = 0;
    let lastAnimated = null;

    for (let c = 0; c < COLS; c++) {
      const g = document.createElement('div');
      g.className = 'ghost';
      previewEl.append(g);
      ghosts.push(g);
    }
    for (let r = 0; r < ROWS; r++) {
      cells.push([]);
      for (let c = 0; c < COLS; c++) {
        const cell = document.createElement('div');
        cell.className = 'cell';
        cell.dataset.col = c;
        boardEl.append(cell);
        cells[r].push(cell);
      }
    }

    const link = `${location.origin}/r/${room}`;
    $('share-link').value = link;
    $('copy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(link); }
      catch { $('share-link').select(); document.execCommand('copy'); }
      $('copy').textContent = 'Kopiert ✓';
      setTimeout(() => { $('copy').textContent = 'Kopieren'; }, 1500);
    });
    if (navigator.share) {
      $('native-share').hidden = false;
      $('native-share').addEventListener('click', () => {
        navigator.share({ title: 'Vier Gewinnt', text: 'Spiel Vier Gewinnt mit mir!', url: link }).catch(() => {});
      });
    }

    const myTurn = () => state && state.status === 'playing' && state.turn === state.you;

    boardEl.addEventListener('click', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell || !myTurn()) return;
      const col = Number(cell.dataset.col);
      if (state.board[0][col] !== null) return;
      ws.send(JSON.stringify({ type: 'move', col }));
    });
    boardEl.addEventListener('mouseover', (e) => {
      const cell = e.target.closest('.cell');
      ghosts.forEach((g, i) => g.classList.toggle('show', !!cell && myTurn() && i === Number(cell.dataset.col)));
    });
    boardEl.addEventListener('mouseleave', () => ghosts.forEach((g) => g.classList.remove('show')));

    $('rematch').addEventListener('click', () => {
      ws.send(JSON.stringify({ type: 'rematch' }));
    });

    function connect() {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry = 0;
        $('conn').hidden = true;
        ws.send(JSON.stringify({ type: 'join', room, clientId, name: myName, color: myColor }));
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'error') {
          ws.onclose = null;
          ws.close();
          $('error-msg').textContent = msg.message;
          return show('error');
        }
        if (msg.type === 'state') render(msg);
      };
      ws.onclose = () => {
        $('conn').hidden = false;
        const delay = Math.min(1000 * 2 ** retry, 10000);
        retry++;
        setTimeout(connect, delay);
      };
    }
    connect();

    function render(s) {
      const prev = state;
      state = s;
      const me = s.you, opp = 1 - me;
      const pName = (i) => (s.players[i] ? s.players[i].name : 'Wartet…');

      $('p0-name').textContent = pName(0);
      $('p1-name').textContent = pName(1);
      $('p0-score').textContent = s.score[0];
      $('p1-score').textContent = s.score[1];
      [0, 1].forEach((i) => {
        const el = $('pl' + i);
        el.classList.toggle('active', s.status === 'playing' && s.turn === i);
        el.classList.toggle('offline', !!s.players[i] && !s.players[i].connected);
      });
      ghosts.forEach((g) => { g.className = 'ghost p' + me; });

      // Farben der Spieler anwenden
      const root = document.documentElement.style;
      s.players.forEach((p, i) => root.setProperty('--c' + i, p.color));
      const mine = s.players[me]?.color;
      if (mine) { myColor = mine; store.set('vg-color', mine); }
      renderSwatches($('game-colors'), mine, s.players[opp]?.color, (c) => {
        if (c !== mine) ws.send(JSON.stringify({ type: 'color', color: c }));
      });

      $('share').hidden = s.players.length >= 2;

      // Status-Text
      let text;
      const oppOffline = s.players[opp] && !s.players[opp].connected;
      if (s.status === 'waiting') text = 'Warte auf Mitspieler – teile den Link.';
      else if (s.status === 'playing') {
        text = s.turn === me ? 'Du bist dran.' : `${pName(opp)} ist dran …`;
        if (oppOffline) text += ` (${pName(opp)} ist offline)`;
      } else if (s.status === 'won') text = s.winner === me ? 'Du hast gewonnen! 🎉' : `${pName(opp)} hat gewonnen.`;
      else text = 'Unentschieden.';
      $('status').textContent = text;
      document.title = s.status === 'playing' && s.turn === me ? '● Du bist dran – Vier Gewinnt' : 'Vier Gewinnt';

      // Revanche
      const over = s.status === 'won' || s.status === 'draw';
      $('after').hidden = !over;
      if (over) {
        const iWant = s.rematch.includes(me), theyWant = s.rematch.includes(opp);
        $('rematch').disabled = iWant;
        $('rematch').textContent = iWant ? 'Revanche angefragt' : 'Revanche';
        $('rematch-note').textContent = theyWant && !iWant
          ? `${pName(opp)} will eine Revanche!`
          : iWant ? `Warte auf ${pName(opp)} …` : '';
      }

      // Brett
      const winSet = new Set((s.winLine || []).map(([r, c]) => r + ',' + c));
      const lm = s.lastMove;
      const lmKey = lm ? `${s.gameNo}:${lm.row},${lm.col}` : null;
      const animate = lmKey && lmKey !== lastAnimated && prev !== null;
      lastAnimated = lmKey;

      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const cell = cells[r][c];
          const v = s.board[r][c];
          cell.classList.toggle('win', winSet.has(r + ',' + c));
          let disc = cell.firstChild;
          if (v === null) { if (disc) disc.remove(); continue; }
          if (!disc) { disc = document.createElement('div'); cell.append(disc); }
          disc.className = 'disc p' + v;
          if (animate && lm.row === r && lm.col === c) {
            disc.style.setProperty('--from', `-${(r + 1) * 110}%`);
            disc.style.setProperty('--dur', `${0.18 + r * 0.06}s`);
            disc.classList.add('drop');
          }
        }
      }
      boardEl.classList.toggle('can-play', myTurn());
      if (!myTurn()) ghosts.forEach((g) => g.classList.remove('show'));
    }
  }
})();
