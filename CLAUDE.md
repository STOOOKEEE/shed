# SHED — état du projet

Soumission NEAR HACKATHON 2026, track `memecoins`. Memecoin NEP-141 dont la communauté brûle des tokens pour
transformer une mascotte ; chaque cycle devient un NFT « skin » vendu aux enchères (50 % brûlé, 50 % aux
sculpteurs). Historique et décisions : [docs/DEVLOG.md](docs/DEVLOG.md). Spécification : [docs/design.md](docs/design.md).

## Stack

- `contract/` : Rust, near-sdk 5.29, near-contract-standards 5.29 (FT + NFT dans un seul contrat), `uint` (U256).
  Toolchain épinglée 1.93 (`rust-toolchain.toml`), build via `cargo near`.
- `web/` : Vite + TypeScript strict, `@hot-labs/near-connect` (wallet), `near-api-js` (RPC).
- `scripts/` : déploiement testnet, verrouillage (suppression des clés), smoke test testnet (`smoke_testnet.py`).
- `bot/` : annonceur X hors chaîne (Node 22 + TS, `@resvg/resvg-js`), lecture seule sur NEAR, OAuth 1.0a,
  `DRY_RUN=true` par défaut ; systemd durci (`bot/deploy/shed-bot.service`) ou Docker.

## Commandes

- Tests contrat (unitaires + sandbox) : `cd contract && cargo test`
- Lint : `cd contract && cargo clippy --all-targets && cargo fmt --check`
- Build wasm : `cd contract && cargo near build non-reproducible-wasm`
- Démo locale : `cd contract && cargo run --example local_demo`, puis `cd web && VITE_CONTRACT_ID=shed.sandbox VITE_NODE_URL=<url> npm run dev`
- Simulation : `cd contract && cargo run --example simulate` (écrit `docs/simulation.svg`)
- Galerie : `cd contract && cargo run --example gallery` (écrit `docs/gallery/*.svg`)
- Front : `cd web && npm run build`
- Testnet : `[SHED_CYCLE_SECONDS=180] scripts/deploy-testnet.sh <contrat.testnet> <holder.testnet> [--create]`, puis `scripts/lock-contract.sh <contrat.testnet>`
- Smoke test testnet : `scripts/smoke_testnet.py <contrat> <joueur1> <joueur2>` (clés dans le trousseau)
- Bot : `cd bot && npm run build && npm test` ; dry-run : `DRY_RUN=true SHED_CONTRACT_ID=… SHED_RPC_URL=https://test.rpc.fastnear.com node dist/main.js`

## Conventions

- Un module = une responsabilité (voir l'arborescence du README). Logique pure (`pricing`, `schedule`, `render`)
  séparée de l'état du contrat.
- Aucun admin : paramètres fixés par `new`, pas de setter. Toute méthode mutante appelle `advance()` d'abord.
- Le rendu du contrat est la seule source de vérité visuelle (le front affiche les SVG du contrat). L'art est en
  pixel art 32×32 : une feuille texte par trait dans `contract/src/render/sprites/` (en-têtes `= Nom [#couleurs]`,
  32 lignes de 32 caractères, `.` = transparent) ; lettres de couleur dans `render/palette.rs`.
- TDD : tests unitaires dans `contract/src/tests/`, e2e sandbox dans `contract/tests/`.

## Où on en est

- Deux contrats : `contract/` (token NEP-141 + skins + face NFT) et `contract/exuviae/` (collection burn, mint par
  le principal uniquement), art partagé dans `contract/art/`. 97 tests unitaires + 1 e2e sandbox (les deux contrats).
- Démo publique testnet : `shedcoin.testnet` + `exuviae.shedcoin.testnet` (cycles 10 min, holder
  `shedcoin-holder.testnet`). Test : `shed-test.testnet` (3 min). Joueurs de test `molt-lobster-p1/p2.testnet`.
  Clés dans le trousseau macOS. Smoke test complet passé sur les deux (2026-11-12). Contrats NON verrouillés.
- Build : `cargo near build non-reproducible-wasm --no-abi` (l'étape ABI de cargo-near plante sur ce macOS).
- Front : face + exuviae affichés, vérifié en lecture sur testnet ; pas encore testé avec un vrai wallet.
- Bot X prêt en dry-run ; attend les clés OAuth 1.0a du compte @LobsterShed. Pas d'API pour changer l'avatar.
- Restent : verrouillage (accord Armand), vidéo + post X, soumission (champs à fournir par Armand), deadline
  2026-11-14 23:59 UTC.
