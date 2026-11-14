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
- Lint : `cargo clippy --all-targets -- -D warnings && cargo fmt --check` dans `contract/`, `contract/exuviae/`, `contract/art/`
- Build wasm : `cargo near build non-reproducible-wasm --no-abi` dans `contract/exuviae/` puis `contract/`
- CI : `.github/workflows/ci.yml` (fmt, clippy, tests unitaires des 3 crates, wasm, e2e sandbox, bot, build web)
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
  Clés dans le trousseau macOS. Smoke test complet passé sur les deux (2026-11-12). `shedcoin.testnet` et
  `exuviae.shedcoin.testnet` VERROUILLÉS le 2026-11-13 (0 clé) ; jeu vérifié après verrouillage (transform, face, exuvie).
- Build : `cargo near build non-reproducible-wasm --no-abi` (l'étape ABI de cargo-near plante sur ce macOS).
- Front hébergé : <https://shedcoin.vercel.app> (projet Vercel `shedcoin`, compte stoookeee, lié depuis `web/` ;
  redéployer : `cd web && vercel deploy --prod --yes`, pas de déploiement auto). Miroir auto à chaque push :
  <https://stoookeee.github.io/shed/> (`.github/workflows/pages.yml`). Lectures RPC en failover sur 4 endpoints
  publics testnet (`config.ts`). Pas encore testé avec un vrai wallet.
- Bot X EN LIGNE (postes réels) sur `serveur` (SSH) : conteneur Docker `shed-bot`, env `~/shed-bot/shed-bot.env`
  (600), suit `shedcoin.testnet`. App X du compte dev « stoke », autorisée par @LobsterShed via le flux PIN
  (`bot/src/authorize.ts`). Clés locales : `~/.shed-x-keys.env`. Redéployer : rsync `bot/` vers `serveur:shed-bot/app`,
  `docker build -t shed-bot .` puis relancer le conteneur (`--read-only --cap-drop ALL`).
- Vidéo de démo : `docs/media/shed-demo.mp4` (76 s, voix Kokoro locale ; script dans `~/Downloads/shed-video/SCRIPT.md`).
- SOUMIS le 2026-11-14 (HTTP 201), tracks `memecoins` + `nfts`, paiement `stoookeee.near`. Post de démo :
  https://x.com/LobsterShed/status/2121540352486387905. Autre projet déclaré (Q-015) : Tilt House. Garder la démo
  (Vercel, bot) en ligne au moins jusqu'au 2026-11-18, idéalement 2026-11-25. Résultats le 2026-11-18.
