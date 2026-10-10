import { createChart } from 'lightweight-charts';
import './style.css';

const GATEWAY = import.meta.env.VITE_GATEWAY_URL || 'http://localhost:8080';
const API_KEY = import.meta.env.VITE_API_KEY || 'demo-key';
const SYMBOLS = ['AAPL', 'MSFT', 'TSLA', 'NVDA', 'AMD', 'GOOG'];
const BOARD_REFRESH_MS = 1000;
const CHART_REFRESH_MS = 3000;

const headers = { 'X-API-Key': API_KEY };

const statusEl = document.getElementById('status');
const tbody = document.querySelector('#priceboard tbody');
const chartTitleEl = document.getElementById('chart-title');

const prevLast = new Map();

function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return '—';
  return n.toFixed(2);
}

async function fetchTicker(symbol) {
  const res = await fetch(`${GATEWAY}/ticker?symbol=${encodeURIComponent(symbol)}`, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.ticker;
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

async function refreshBoard() {
  await Promise.all(
    SYMBOLS.map(async (sym) => {
      try {
        const t = await fetchTicker(sym);
        renderRow(sym, t);
        statusEl.textContent = 'live';
      } catch (e) {
        statusEl.textContent = `error: ${e.message}`;
      }
    }),
  );
}

// ---- Chart (TradingView Lightweight Charts) ----
const chartEl = document.getElementById('chart');
const chart = createChart(chartEl, {
  width: chartEl.clientWidth,
  height: 400,
  layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
  grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
  timeScale: { timeVisible: true, secondsVisible: false },
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

async function refreshChart() {
  try {
    const candles = await fetchOHLCV(currentSymbol);
    candleSeries.setData(
      candles.map((c) => ({
        time: c.timestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
  } catch {
    // keep the last frame on transient errors
  }
}

function selectSymbol(symbol, row) {
  currentSymbol = symbol;
  tbody.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
  if (row) row.classList.add('selected');
  chartTitleEl.textContent = `${symbol} · 1m`;
  refreshChart();
}

// Boot
refreshBoard();
refreshChart();
selectSymbol(currentSymbol, null);
setInterval(refreshBoard, BOARD_REFRESH_MS);
setInterval(refreshChart, CHART_REFRESH_MS);

window.addEventListener('resize', () => {
  chart.applyOptions({ width: chartEl.clientWidth });
});
