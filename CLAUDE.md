# MOLT — état du projet

Soumission NEAR HACKATHON 2026, track `memecoins`. Memecoin NEP-141 dont la communauté brûle des tokens pour
transformer une mascotte ; chaque cycle devient un NFT « skin » vendu aux enchères (50 % brûlé, 50 % aux
sculpteurs). Historique et décisions : [docs/DEVLOG.md](docs/DEVLOG.md). Spécification : [docs/design.md](docs/design.md).

## Stack

- `contract/` : Rust, near-sdk 5.29, near-contract-standards 5.29 (FT + NFT dans un seul contrat), `uint` (U256).
  Toolchain épinglée 1.93 (`rust-toolchain.toml`), build via `cargo near`.
- `web/` : Vite + TypeScript strict, `@hot-labs/near-connect` (wallet), `near-api-js` (RPC).
- `scripts/` : déploiement testnet, verrouillage (suppression des clés), smoke test testnet (`smoke_testnet.py`).
- `bot/` : annonceur X hors chaîne (Node 22 + TS, `@resvg/resvg-js`), lecture seule sur NEAR, OAuth 1.0a,
  `DRY_RUN=true` par défaut ; systemd durci (`bot/deploy/molt-bot.service`) ou Docker.

## Commandes

- Tests contrat (unitaires + sandbox) : `cd contract && cargo test`
- Lint : `cd contract && cargo clippy --all-targets && cargo fmt --check`
- Build wasm : `cd contract && cargo near build non-reproducible-wasm`
- Démo locale : `cd contract && cargo run --example local_demo`, puis `cd web && VITE_CONTRACT_ID=molt.sandbox VITE_NODE_URL=<url> npm run dev`
- Simulation : `cd contract && cargo run --example simulate` (écrit `docs/simulation.svg`)
- Galerie : `cd contract && cargo run --example gallery` (écrit `docs/gallery/*.svg`)
- Front : `cd web && npm run build`
- Testnet : `[MOLT_CYCLE_SECONDS=180] scripts/deploy-testnet.sh <contrat.testnet> <holder.testnet> [--create]`, puis `scripts/lock-contract.sh <contrat.testnet>`
- Smoke test testnet : `scripts/smoke_testnet.py <contrat> <joueur1> <joueur2>` (clés dans le trousseau)
- Bot : `cd bot && npm run build && npm test` ; dry-run : `DRY_RUN=true MOLT_CONTRACT_ID=… MOLT_RPC_URL=https://test.rpc.fastnear.com node dist/main.js`

## Conventions

- Un module = une responsabilité (voir l'arborescence du README). Logique pure (`pricing`, `schedule`, `render`)
  séparée de l'état du contrat.
- Aucun admin : paramètres fixés par `new`, pas de setter. Toute méthode mutante appelle `advance()` d'abord.
- Le rendu du contrat est la seule source de vérité visuelle (le front affiche les SVG du contrat). L'art est en
  pixel art 32×32 : une feuille texte par trait dans `contract/src/render/sprites/` (en-têtes `= Nom [#couleurs]`,
  32 lignes de 32 caractères, `.` = transparent) ; lettres de couleur dans `render/palette.rs`.
- TDD : tests unitaires dans `contract/src/tests/`, e2e sandbox dans `contract/tests/`.

## Où on en est

- Contrat complet, revu et testé (108 tests unitaires + 1 e2e sandbox), mascotte pixel art validée, NFT « face »
  (mint au sculpteur, burn du précédent, non transférable). Front fonctionnel en lecture.
- Testnet de test : `molt-lobster-test.testnet` (cycles 3 min, holder `molt-lobster-holder.testnet`, joueurs
  `molt-lobster-p1/p2.testnet`, clés dans le trousseau macOS) ; smoke test complet passé le 2026-11-03.
- Bot X prêt en dry-run ; attend le compte X, l'app développeur (OAuth 1.0a read+write) et des crédits.
- Restent : refonte UI (+ signature des sculpteurs sur les skins si validée), déploiement démo testnet
  `molt-lobster.testnet` (cycles 10 min) + verrouillage, test wallet, mainnet (sur confirmation explicite),
  `repository` dans `contract/Cargo.toml`, vidéo + post X, soumission.
