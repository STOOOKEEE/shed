# SHED web app

Single-page front end for the SHED contract (Vite + vanilla TypeScript).
Views go straight to NEAR RPC with `near-api-js`; signing goes through `@hot-labs/near-connect`.

## Install

```bash
npm install
```

## Configure

Copy `.env.example` to `.env` and set:

| variable | required | meaning |
| --- | --- | --- |
| `VITE_CONTRACT_ID` | yes | account id of the deployed SHED contract |
| `VITE_NETWORK` | no | `testnet` (default) or `mainnet` |
| `VITE_NODE_URL` | no | custom RPC, e.g. `http://127.0.0.1:3030` for a local sandbox. Enables read-only mode (no wallet). |
| `VITE_REPO_URL` | no | public repo URL, used for the README / rules links in the footer |

## Run

```bash
npm run dev      # dev server on http://localhost:5173
npm run build    # type-check (tsc --noEmit, strict) + production build in dist/
npm run preview  # serve dist/
```

Views refresh every 10 s and after each transaction. If the RPC is unreachable or the contract is not
deployed, the page shows the error and keeps retrying.
