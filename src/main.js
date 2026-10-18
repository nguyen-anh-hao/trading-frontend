import { createChart } from 'lightweight-charts';
import './style.css';

const GATEWAY = (import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080').replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_API_KEY || 'demo-key';
const SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMD', 'GOOG'];
const WS_URL =
  import.meta.env.VITE_WS_URL ||
  `${GATEWAY.replace(/^http/, 'ws')}/ws?symbols=${SYMBOLS.join(',')}` +
    `&channels=ticker,candle,trade&api_key=${encodeURIComponent(API_KEY)}`;

const headers = { 'X-API-Key': API_KEY };

const statusEl = document.getElementById('status');
const tbody = document.querySelector('#priceboard tbody');
const chartTitleEl = document.getElementById('chart-title');

const prevLast = new Map();
const candleCache = new Map(); // symbol -> normalized, ascending 1m bars
const historyLoaded = new Set();
const historyPending = new Set();

const CANDLE_INTERVAL_SECONDS = 60;

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(2);
}

async function fetchOHLCV(symbol, interval = '1m') {
  const res = await fetch(
    `${GATEWAY}/ohlcv?symbol=${encodeURIComponent(symbol)}&interval=${interval}&limit=120`,
    { headers },
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.candles || [];
}

function renderRow(symbol, ticker) {
  let row = tbody.querySelector(`tr[data-symbol="${symbol}"]`);
  if (!row) {
    row = document.createElement('tr');
    row.dataset.symbol = symbol;
    row.innerHTML =
      `<td class="sym">${symbol}</td>` +
      `<td class="last">—</td>` +
      `<td class="bid">—</td>` +
      `<td class="ask">—</td>` +
      `<td class="spread">—</td>`;
    row.addEventListener('click', () => selectSymbol(symbol, row));
    tbody.appendChild(row);
  }

  const last = Number(ticker.last_price);
  const bid = Number(ticker.best_bid);
  const ask = Number(ticker.best_ask);
  const spread = bid > 0 && ask > 0 ? (ask - bid).toFixed(2) : '—';

  const lastCell = row.querySelector('.last');
  lastCell.textContent = fmt(last);
  lastCell.className = 'last';
  const prev = prevLast.get(symbol);
  if (prev != null && last > prev) lastCell.classList.add('up');
  else if (prev != null && last < prev) lastCell.classList.add('down');
  prevLast.set(symbol, last);

  row.querySelector('.bid').textContent = fmt(bid);
  row.querySelector('.ask').textContent = fmt(ask);
  row.querySelector('.spread').textContent = spread;
}

// ---- Chart (TradingView Lightweight Charts) ----
const chartEl = document.getElementById('chart');
const chart = createChart(chartEl, {
  width: chartEl.clientWidth,
  height: 400,
  layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
  grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
  timeScale: {
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 2,
    // Keep the viewport pinned to the newest bar as live candles arrive.
    shiftVisibleRangeOnNewBar: true,
  },
});
const candleSeries = chart.addCandlestickSeries({
  upColor: '#26a69a',
  downColor: '#ef5350',
  borderUpColor: '#26a69a',
  borderDownColor: '#ef5350',
  wickUpColor: '#26a69a',
  wickDownColor: '#ef5350',
});

let currentSymbol = SYMBOLS[0];
let lastRenderedTime = 0;

// Epoch timestamps can arrive in seconds (candles) or nanoseconds (trades).
function epochSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e17) return Math.floor(n / 1e9); // nanoseconds
  if (n > 1e14) return Math.floor(n / 1e6); // microseconds
  if (n > 1e12) return Math.floor(n / 1e3); // milliseconds
  return Math.floor(n); // seconds
}

function toBar(c) {
  if (!c) return null;
  const time = epochSeconds(c.timestamp ?? c.time);
  const open = Number(c.open);
  const high = Number(c.high);
  const low = Number(c.low);
  const close = Number(c.close);
  if (!time || ![open, high, low, close].every(Number.isFinite)) return null;
  return { time, open, high, low, close };
}

// Keeps a sorted, duplicate-free cache. A newer version of an existing bucket
// replaces the old one (the in-progress candle is updated in place).
// `replaceExisting=false` is used for HTTP history so a late history response
// cannot overwrite newer live data for the current bucket.
function storeBar(symbol, bar, replaceExisting = true) {
  const bars = candleCache.get(symbol) || [];
  let i = bars.length - 1;
  while (i >= 0 && bars[i].time > bar.time) i--;
  if (i >= 0 && bars[i].time === bar.time) {
    if (replaceExisting) bars[i] = bar;
  } else if (i === bars.length - 1) bars.push(bar);
  else bars.splice(i + 1, 0, bar);
  candleCache.set(symbol, bars);
}

function mergeCandles(symbol, candles, replaceExisting = true) {
  for (const raw of candles || []) {
    const bar = toBar(raw);
    if (bar) storeBar(symbol, bar, replaceExisting);
  }
}

// setData() resets the viewport, so only call it when switching symbols (or
// when a stale bar forces a full redraw). Live updates use update().
function renderSymbol(symbol) {
  const bars = candleCache.get(symbol) || [];
  lastRenderedTime = bars.length ? bars[bars.length - 1].time : 0;
  candleSeries.setData(bars);
  if (bars.length) chart.timeScale().scrollToRealTime();
}

function drawBar(symbol, bar) {
  if (symbol !== currentSymbol) return;
  // update() throws if the bar is older than the latest one; older data can
  // still land in the cache (e.g. a replayed trade) but must not move the chart.
  if (bar.time < lastRenderedTime) return;
  candleSeries.update(bar);
  lastRenderedTime = bar.time;
}

function applyCandle(symbol, raw) {
  const bar = toBar(raw);
  if (!bar) return;
  storeBar(symbol, bar);
  drawBar(symbol, bar);
}

// The candle channel only fires when a trade is ingested (NATS). Ticker and
// trade messages are more frequent, so fold their price into the live 1m bar.
// When the authoritative candle arrives it replaces this provisional bar.
function applyPrice(symbol, rawPrice, timestamp) {
  const price = Number(rawPrice);
  if (!Number.isFinite(price) || price <= 0) return;

  const ts = epochSeconds(timestamp) || Math.floor(Date.now() / 1000);
  const bucket = ts - (ts % CANDLE_INTERVAL_SECONDS);
  const bars = candleCache.get(symbol) || [];
  const last = bars[bars.length - 1];

  let bar;
  if (!last) {
    bar = { time: bucket, open: price, high: price, low: price, close: price };
  } else if (bucket > last.time) {
    // No trade in the new bucket yet: keep the previous bar rather than
    // fabricating a flat minute. A changed price starts the new bar.
    if (price === last.close) return;
    bar = { time: bucket, open: price, high: price, low: price, close: price };
  } else {
    // Same bucket (or a server clock slightly ahead of the browser): keep the
    // existing OHLC envelope and only move the close/high/low.
    bar = { ...last, high: Math.max(last.high, price), low: Math.min(last.low, price), close: price };
  }
  storeBar(symbol, bar);
  drawBar(symbol, bar);
}

async function loadHistory(symbol) {
  if (historyLoaded.has(symbol) || historyPending.has(symbol)) return;
  historyPending.add(symbol);
  try {
    const candles = await fetchOHLCV(symbol);
    mergeCandles(symbol, candles, false);
    historyLoaded.add(symbol);
    // The user may have switched symbols while this request was in flight.
    if (symbol === currentSymbol) renderSymbol(symbol);
  } catch {
    // keep the last frame on transient errors; retry on the next select
  } finally {
    historyPending.delete(symbol);
  }
}

function selectSymbol(symbol, row) {
  currentSymbol = symbol;
  tbody.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
  if (row) row.classList.add('selected');
  chartTitleEl.textContent = `${symbol} · 1m`;
  renderSymbol(symbol);
  loadHistory(symbol);
}

// ---- WebSocket stream ----
let ws = null;
let reconnectDelay = 1000;
let reconnectTimer = null;

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectStream, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 15000);
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  switch (msg.type) {
    case 'snapshot': {
      const snap = msg.data || {};
      (snap.tickers || []).forEach((t) => renderRow(t.symbol, t));
      Object.entries(snap.candles || {}).forEach(([symbol, candles]) => {
        mergeCandles(symbol, candles);
      });
      renderSymbol(currentSymbol);
      // A snapshot may only carry the current bucket; backfill the rest from
      // the HTTP history endpoint once per symbol.
      loadHistory(currentSymbol);
      break;
    }
    case 'ticker':
      if (msg.symbol && msg.data) {
        renderRow(msg.symbol, msg.data);
        applyPrice(msg.symbol, msg.data.last_price, Date.now() / 1000);
      }
      break;
    case 'candle':
      if (!msg.data || (msg.interval && msg.interval !== '1m')) break;
      applyCandle(msg.symbol, msg.data);
      break;
    case 'trade':
      if (msg.symbol && msg.data) {
        applyPrice(msg.symbol, msg.data.price, msg.data.timestamp_ns);
      }
      break;
    default:
      break;
  }
}

function connectStream() {
  clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  statusEl.textContent = 'connecting…';
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    statusEl.textContent = 'live';
    reconnectDelay = 1000;
  };
  ws.onmessage = (ev) => handleMessage(ev.data);
  ws.onerror = () => {
    try {
      ws.close();
    } catch {
      // ignore: onclose is the single reconnect path
    }
  };
  ws.onclose = () => {
    ws = null;
    statusEl.textContent = 'reconnecting…';
    scheduleReconnect();
  };
}

// Boot: render the board shell, then let the stream fill it.
SYMBOLS.forEach((s) => renderRow(s, {}));
selectSymbol(currentSymbol, tbody.querySelector('tr[data-symbol="AAPL"]'));
connectStream();

window.addEventListener('resize', () => {
  chart.applyOptions({ width: chartEl.clientWidth });
});
