# Trading Frontend (`trading-frontend`)

> **Real-Time Web Trading Dashboard & Priceboard** built with Vue/Vite, TypeScript, and TradingView Lightweight Charts.

---

## 1. Primary Responsibility
The frontend renders the interactive trading station for retail users:
- **Real-Time Priceboard:** Live Bid/Ask depth ladder and Order Book visualization.
- **Interactive Candlestick Charting:** Streaming tick data rendered via Canvas-based `lightweight-charts`.
- **Order Placement & Execution:** Instant trade dispatch and toast execution notifications.

---

## 2. Boundaries & Network
- Connects to `api-gateway` via:
  - **REST API:** `http://localhost:8080` (Order placement, history, balances)
  - **WebSocket Feed:** `ws://localhost:8080/ws` (Streaming L2 depth and trades)

---

## 3. Quick Start (Run in 1 minute)

```bash
# Install dependencies
npm install

# Run with Vite Hot-Module Replacement (HMR)
npm run dev
```

Open browser at: `http://localhost:5173`

---

## 4. Engineering Roadmap (Rendering & Web Performance)

| Version | Phase | Optimization Target & Browser Bottleneck |
| :--- | :--- | :--- |
| **v1.0.0** *(Current)* | **Baseline SPA** | Reactive DOM updates, Lightweight Charts canvas rendering, WebSocket connection handling. |
| **v1.1.0** | **Binary WebSocket Streaming** | Deserialize incoming WebSocket market data ticks directly from Protobuf binary array buffers (`ArrayBuffer` / `Uint8Array`) using `@bufbuild/protobuf` instead of JSON string parsing. |
| **v1.2.0** | **Web Workers & OffscreenCanvas** | Move WebSocket ingestion and Order Book aggregation to a dedicated Web Worker thread. Render 60 FPS orderbook ladders and depth charts via `OffscreenCanvas` to guarantee zero UI stuttering during high-frequency volatility bursts. |
| **v2.0.0** | **WASM Fast-Feed Parser** | Implement Rust/C++ compiled WebAssembly (WASM) parser inside the browser worker to process 50,000 market depth ticks/sec with zero garbage collection (GC) pauses. |
