# trading-frontend

## Purpose

The browser trading station: a live priceboard, a candlestick chart and an order ticket that talk to the edge over REST and a WebSocket stream. It renders state but owns no business rules and persists nothing locally. It does not authenticate on its own; it presents an API key supplied at build time.

## Domain knowledge

The chart loads up to one hundred twenty one-minute bars over REST once per symbol, then keeps them live from the stream. Ticker and trade events are more frequent than candles, so their prices are folded into a provisional one-minute bar that an authoritative candle later replaces. The provisional bar never fabricates a flat minute: if no trade happened in the new bucket and the price did not move, the previous bar is kept.

The stream sends a snapshot on connect and then ticker, candle and trade messages, and the client reconnects with exponential backoff from one second up to fifteen seconds. Timestamps arrive either as seconds or nanoseconds depending on the message type, so the client normalizes them before bucketing. Only one-minute candles are charted; other intervals are ignored by the browser.

The priceboard is driven entirely by ticker messages and never polls. Symbol history is cached per symbol for the session, so switching back and forth does not refetch. The API key is part of the WebSocket URL as well as the REST headers, which means it is visible to anyone who can inspect the page.

## Decisions and consequences

**WebSocket streaming instead of polling.** Prices and candles feel live and the backend sees one connection per client. The cost is connection lifecycle complexity, including reconnect, snapshot resynchronization and duplicate bars.

**Vanilla JavaScript with Vite.** There is no framework runtime and the whole station stays small. The cost is manual DOM updates and hand-written state management for the priceboard and chart.

**Provisional candle merged from tick and trade prices.** Charts move even when no candle event has arrived yet. The risk is temporary divergence from the authoritative bar, which is why the server candle always replaces the provisional one.

**Build-time API key.** Configuration is a single environment variable and the demo works with no login flow. The consequence is that the key ships to the browser and cannot be treated as a secret.

## Operations and known limits

The edge must be running before the page is useful; the WebSocket URL is derived from the gateway URL unless explicitly overridden. The development server runs on port 5173, while the production preview runs on 4173. A CORS or authentication failure appears as a stalled priceboard with a reconnect loop rather than an explicit error banner.

There is no offline cache, no persisted layout and no history older than the initial REST load plus whatever the stream delivers. The chart only accepts one-minute candles, so longer intervals require a UI change. Reconnect always starts a new snapshot, which is also the only recovery path after a long disconnect.

Because the API key is embedded in the bundle, this frontend is suitable for demos and internal use, not for public deployment. Charts redraw from the in-memory cache on symbol switch, so a full page reload loses the session history and refetches it.

## Future direction

Business: watchlists, order history and multi-chart layouts are the obvious next features; none are implemented.

Technical: binary WebSocket payloads, a Web Worker for ingestion and order-book aggregation, and offscreen canvas rendering for high-frequency updates. A WebAssembly parser is the later step for very high message rates.

Boundaries: authentication should move to short-lived browser tokens issued by the edge, removing the build-time key from the bundle.
