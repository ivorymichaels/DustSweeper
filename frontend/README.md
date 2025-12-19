# Sweeper Frontend (Vite + React)

Quick scaffold for the Sweeper frontend. Contains a demo page at `src/pages/Sweeper.jsx`.

Run locally:

1. Install deps:

```bash
npm --prefix frontend install
```

2. Run dev server:

```bash
npm --prefix frontend run dev
```

Notes:
- The UI includes a WalletConnect component (uses Web3Modal + ethers).
- `src/lib/permitBuilder.js` is a placeholder — replace with Permit2 SDK logic in production.
- `src/lib/price.js` (already present) is used to fetch prices.
