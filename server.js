// Vier Gewinnt – Server
// Liefert die Webseite aus und synchronisiert die Spiele per WebSocket.
// Der Server ist die "Wahrheit": Er prüft jeden Zug, damit niemand schummeln kann.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const ROWS = 6;
const COLS = 7;

// ---------- Spielhistorie (eine JSON-Zeile pro beendetem Spiel) ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
let history = [];
try {
  for (const line of fs.readFileSync(HISTORY_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { history.push(JSON.parse(line)); } catch { /* kaputte Zeile überspringen */ }
  }
} catch { /* Datei existiert noch nicht */ }

function addHistory(entry) {
  history.push(entry);
  if (history.length > 2000) history = history.slice(-2000);
  fs.appendFile(HISTORY_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('Historie konnte nicht gespeichert werden:', err.message);
  });
}

// ---------- Webserver (Dateien + Historie-API) ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }

  // Nur die Spiele des anfragenden Geräts zurückgeben
  if (url.pathname === '/api/history') {
    const client = url.searchParams.get('client') || '';
    const mine = history
      .filter((h) => h.clients && h.clients.includes(client))
      .slice(-20)
      .reverse()
      .map((h) => ({
        ts: h.ts,
        players: h.players,
        winner: h.winner,
        you: h.clients.indexOf(client),
        moves: h.moves,
      }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify(mine));
  }

  // Startseite und Spielräume (/r/xyz) nutzen dieselbe HTML-Datei
  const file = url.pathname === '/' || url.pathname.startsWith('/r/')
    ? 'index.html'
    : url.pathname.slice(1);
  const full = path.normalize(path.join(PUBLIC_DIR, file));
  if (!full.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Nicht gefunden');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

// ---------- Spiellogik ----------
const rooms = new Map();

const newBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(null));

function getRoom(id) {
  let room = rooms.get(id);
  if (!room) {
    room = {
      id,
      players: [],          // { id, name, ws, connected }
      board: newBoard(),
      turn: 0,
      starter: 0,
      status: 'waiting',    // waiting | playing | won | draw
      winner: null,
      winLine: null,
      lastMove: null,
      moves: 0,
      score: [0, 0],
      draws: 0,
      gameNo: 1,
      rematch: new Set(),
      emptySince: null,
    };
    rooms.set(id, room);
  }
  return room;
}

function findWin(b, r, c, p) {
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const line = [[r, c]];
    for (const s of [1, -1]) {
      let rr = r + dr * s;
      let cc = c + dc * s;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr][cc] === p) {
        line.push([rr, cc]);
        rr += dr * s;
        cc += dc * s;
      }
    }
    if (line.length >= 4) return line;
  }
  return null;
}

function recordGame(room) {
  addHistory({
    ts: Date.now(),
    room: room.id,
    players: room.players.map((p) => p.name),
    clients: room.players.map((p) => p.id),
    winner: room.status === 'won' ? room.winner : null,
    moves: room.moves,
  });
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room) {
  room.players.forEach((p, seat) => {
    send(p.ws, {
      type: 'state',
      room: room.id,
      you: seat,
      players: room.players.map((x) => ({ name: x.name, connected: x.connected, color: x.color })),
      board: room.board,
      turn: room.turn,
      status: room.status,
      winner: room.winner,
      winLine: room.winLine,
      lastMove: room.lastMove,
      moves: room.moves,
      score: room.score,
      draws: room.draws,
      gameNo: room.gameNo,
      rematch: [...room.rematch],
    });
  });
}

// Erlaubte Steinfarben (aus der Farbpalette)
const COLORS = ['#41459e', '#56bca6', '#479dcc', '#c75c48', '#f2c35b'];

// Gewünschte Farbe vergeben – oder die erste freie, falls sie schon belegt ist
function pickColor(room, seat, wanted) {
  const other = room.players[1 - seat]?.color;
  if (COLORS.includes(wanted) && wanted !== other) return wanted;
  return COLORS.find((c) => c !== other);
}

const cleanName = (n) =>
  String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 20) || 'Spieler';

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2048 });

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'join') {
      const roomId = String(msg.room || '').toLowerCase();
      const clientId = String(msg.clientId || '').slice(0, 64);
      if (!/^[a-z0-9]{4,32}$/.test(roomId) || !clientId) {
        return send(ws, { type: 'error', message: 'Ungültiger Spiel-Link.' });
      }
      const room = getRoom(roomId);
      let seat = room.players.findIndex((p) => p.id === clientId);
      if (seat === -1) {
        if (room.players.length >= 2) {
          return send(ws, { type: 'error', code: 'full', message: 'Dieses Spiel hat schon zwei Spieler.' });
        }
        room.players.push({ id: clientId, name: cleanName(msg.name), ws, connected: true });
        seat = room.players.length - 1;
        room.players[seat].color = pickColor(room, seat, msg.color);
        if (room.players.length === 2 && room.status === 'waiting') room.status = 'playing';
      } else {
        // Wiederverbindung (z. B. Seite neu geladen)
        const p = room.players[seat];
        if (p.ws && p.ws !== ws) { try { p.ws.close(); } catch {} }
        p.ws = ws;
        p.connected = true;
        p.name = cleanName(msg.name);
      }
      ws.roomId = roomId;
      ws.seat = seat;
      room.emptySince = null;
      return broadcast(room);
    }

    const room = rooms.get(ws.roomId);
    if (!room || room.players[ws.seat]?.ws !== ws) return;

    if (msg.type === 'move') {
      if (room.status !== 'playing' || room.turn !== ws.seat) return;
      const col = Number(msg.col);
      if (!Number.isInteger(col) || col < 0 || col >= COLS) return;
      let row = -1;
      for (let r = ROWS - 1; r >= 0; r--) {
        if (room.board[r][col] === null) { row = r; break; }
      }
      if (row < 0) return; // Spalte voll

      room.board[row][col] = ws.seat;
      room.lastMove = { row, col };
      room.moves++;

      const line = findWin(room.board, row, col, ws.seat);
      if (line) {
        room.status = 'won';
        room.winner = ws.seat;
        room.winLine = line;
        room.score[ws.seat]++;
        recordGame(room);
      } else if (room.moves === ROWS * COLS) {
        room.status = 'draw';
        room.draws++;
        recordGame(room);
      } else {
        room.turn = 1 - room.turn;
      }
      return broadcast(room);
    }

    if (msg.type === 'color') {
      const other = room.players[1 - ws.seat]?.color;
      if (COLORS.includes(msg.color) && msg.color !== other) {
        room.players[ws.seat].color = msg.color;
        broadcast(room);
      }
      return;
    }

    if (msg.type === 'rematch') {
      if (room.status !== 'won' && room.status !== 'draw') return;
      room.rematch.add(ws.seat);
      if (room.rematch.size === 2) {
        room.board = newBoard();
        room.starter = 1 - room.starter; // Startspieler wechselt
        room.turn = room.starter;
        room.status = 'playing';
        room.winner = null;
        room.winLine = null;
        room.lastMove = null;
        room.moves = 0;
        room.gameNo++;
        room.rematch.clear();
      }
      return broadcast(room);
    }
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    const p = room.players[ws.seat];
    if (!p || p.ws !== ws) return;
    p.connected = false;
    p.ws = null;
    if (room.players.every((x) => !x.connected)) room.emptySince = Date.now();
    broadcast(room);
  });
});

// Tote Verbindungen erkennen (z. B. Handy im Standby)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

// Verlassene Räume nach 6 Stunden aufräumen
setInterval(() => {
  const cutoff = Date.now() - 6 * 60 * 60 * 1000;
  for (const [id, room] of rooms) {
    if (room.emptySince && room.emptySince < cutoff) rooms.delete(id);
  }
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log(`Vier Gewinnt läuft auf Port ${PORT}`));
