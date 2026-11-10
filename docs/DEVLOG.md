# DEVLOG

## 2026-11-03 — MOLT v1 : contrat, simulation, front

**Quoi.** Contrat unique NEP-141 + NEP-171 : `transform` brûle le prix d'un slot (×1,5 par changement du même
slot dans le cycle), le cycle clos devient un skin NFT (SVG rendu onchain) mis aux enchères en $MOLT ; 50 % de
l'enchère gagnante est brûlé, 50 % réparti pro-rata aux sculpteurs du cycle. Airdrop de démo, journal onchain
borné (64 entrées) + événements NEP-297. Front Vite/TS. Simulation 60 cycles. Démo sandbox locale.

**Pourquoi.** Le jury de la track juge la mécanique, pas le chart : tout est dans le contrat, sans backend ni
clé admin, paramètres lisibles via `config()`.

**Cheminement.**
- Enchères en $MOLT plutôt qu'en NEAR : le brûlage est direct (pas de buyback via DEX) et tout reste interne
  au contrat, sans appel cross-contract ni callback.
- Un seul contrat FT + NFT plutôt que deux : burns, escrows et transferts de skins sont des mutations d'état
  locales, aucune surface de réentrance.
- Pas de keeper : chaque méthode mutante « rattrape le temps » (`advance`), `molt()` est public et sans effet
  si rien n'est dû. Cycles alignés sur un calendrier fixe (`genesis + n × durée`) pour des fins prévisibles.
- Parts des sculpteurs en *pull* (`claim_sculptor_share`) plutôt que distribuées en boucle : gas borné.
- Paliers de prix par slot (et non par compte) : les multi-comptes ne sculptent pas moins cher ; parts
  linéaires : se diviser en alts ne rapporte rien.
- Slots à variantes finies (pas d'upload) : rien à modérer.
- SVG stocké dans `media` (base64) plutôt qu'une URL : l'art ne dépend d'aucun serveur. Budget 4 kB testé.
- Paramètre de base choisi par simulation : 10 000 MOLT (0,001 % de l'offre) → ~12 % brûlés en 60 jours pour
  une communauté stable ; 100 000 viderait l'offre, 1 000 rend le burn cosmétique.
- Rendu sans flottants (échelles en dixièmes) pour rester déterministe et léger en wasm.

**Risques traités dès la conception.**
- Un enchérisseur aurait pu se désinscrire du storage FT pour faire paniquer tout remboursement, donc bloquer
  les surenchères et gagner au prix minimum. `pay_out` réinscrit le destinataire si besoin (test
  `a_bidder_who_unregistered_is_still_refunded`).
- `pro_rata` déborderait en u128 (pool × contribution ≈ 10⁴⁹) : calcul en U256 (`uint`).

**Bugs & fix.**
- Sandbox : `fast_forward(n)` n'avance pas le temps de n secondes exactement (la démo locale ne passait pas le
  cycle). Les helpers attendent maintenant le changement de cycle lu dans la vue `mascot` (`wait_cycles`).
- Test e2e : débordement u128 dans le calcul attendu de la part de Bob, recalculé en MOLT entiers.
- Navigateur headless géré par l'outil : captures d'écran bloquées, contourné en mode `headed`.

## 2026-11-03 — Revue sécurité du contrat

**Quoi.** Revue par un agent reviewer (aucun P0/P1) puis correctifs : stockage prépayé par les appelants
(`transform_deposit`, `airdrop_deposit`), garde « le compte du contrat ne peut ni sculpter, ni enchérir, ni se
désinscrire », un meilleur enchérisseur ne peut pas se désinscrire, relancer sa propre enchère ne met en séquestre
que la différence, `molt_pending` vrai seulement si un skin est dû. Front adapté (dépôts lus dans les vues).

**Pourquoi.** P2 : le contrat payait seul le stockage (~5,8 kB par skin) ; avec l'airdrop gratuit, quelques
comptes pouvaient épuiser son solde NEAR et bloquer `advance()` (donc tout le jeu). P3 : avant verrouillage, le
compte du contrat pouvait devenir top sculpteur, et `settle` paniquait alors à vie (transfert contrat → contrat).

**Cheminement.**
- Prépaiement mesuré par appel plutôt qu'un forfait par transformation : un forfait sous-financerait les cycles à
  une seule transformation. Le premier sculpteur d'un cycle paie le skin (7 kB), chaque nouveau sculpteur son
  entrée de contribution (400 o) ; budgets vérifiés par des tests sur le pire cas (plus gros SVG, comptes de
  64 caractères, cycle de vie complet mint → enchère → règlement).
- Abandon de la réinscription automatique dans `pay_out` (elle permettait de soutirer 0,00125 NEAR par
  surenchère) au profit d'une interdiction de `storage_unregister` pour les meilleurs enchérisseurs.

**Bugs & fix.**
- Mon test `an_outbid_account_can_unregister` désinscrivait le meilleur enchérisseur au lieu de l'enchérisseur
  surenchéri : corrigé (le garde fonctionnait).

## 2026-11-03 — Mascotte en pixel art 32×32

**Quoi.** Remplacement du rendu vectoriel par du pixel art 32×32 : homard chibi (grosse carapace-visage, pinces
levées), 6 calques (fond, corps, motif masqué sur le corps, pinces, chapeau, visage). Les sprites sont des feuilles
texte dans `contract/src/render/sprites/` ; le contrat empile les calques et sort un SVG (un `rect` de fond + un
`path` par couleur en traits horizontaux d'un pixel, `crispEdges`). Le slot `eyes` devient un visage (yeux +
bouche).

**Pourquoi.** Armand jugeait la version vectorielle « trop simple, trop IA ». Le pixel art assume la simplicité
comme style, il est reconnu par la culture crypto (Nouns, CryptoPunks) et reste 100 % onchain.

**Cheminement.** Écartés : illustration dessinée à la main (besoin d'un artiste d'ici le 14), ASCII (gadget),
vectoriel enrichi (plafond de qualité trop bas). Maquette itérée en Python (4 versions : formes procédurales trop
grossières → sprite dessiné à la main), puis grilles exportées en texte, qui deviennent la source unique de l'art.
PNG embarqué écarté au profit du SVG : rendu net partout, y compris sur les marketplaces.

**Bugs & fix.** SVG à 4 213 octets dans le pire cas (budget 4 096) : le décalage d'un demi-pixel passe dans un
`<g transform>` au lieu de chaque tracé. Test exhaustif sur toutes les combinaisons de formes (10 080 rendus).

## 2026-11-03 — NFT « face » + premier déploiement testnet

**Quoi.** Chaque `transform` mint au sculpteur un NFT `face-<n>` de la mascotte actuelle et brûle le précédent
(événement NEP-171 `nft_burn`) : un seul existe, chez le dernier sculpteur. Non transférable et non approuvable.
Déploiement de test `molt-lobster-test.testnet` (cycles de 3 min) et script `scripts/smoke_testnet.py` qui joue
une partie complète sur testnet. Bot d'annonces X hors chaîne (dossier `bot/`, sans clé NEAR).

**Pourquoi.** Idée d'Armand : rendre la modification visible et statutaire (« c'est moi le visage de $MOLT »), et
alimenter un compte X qui suit la mascotte.

**Cheminement.**
- Non transférable : un objet qui peut brûler à la minute suivante ne doit pas se vendre (piège pour l'acheteur).
- Image calculée à la lecture (`nft_token`, `nft_tokens*`) depuis le génome courant plutôt que stockée : le
  stockage reste constant (un seul face) et l'image est toujours juste.
- Burn implémenté à la main (la lib standard n'en fournit pas) : propriétaire, métadonnées, énumération,
  approbations, puis `nft_burn`.
- API X : pas d'endpoint v2 documenté pour changer la photo de profil ; le bot poste les nouveaux looks au lieu
  de modifier l'avatar.

**Bugs & fix.**
- `cargo near deploy` (near-cli 0.28 embarqué) ne trouvait pas la clé enregistrée par `near` 0.30 dans le
  trousseau : le script build avec cargo-near puis déploie avec `near contract deploy`.
