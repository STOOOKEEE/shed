# DEVLOG

## 2026-11-03 — SHED v1 : contrat, simulation, front

**Quoi.** Contrat unique NEP-141 + NEP-171 : `transform` brûle le prix d'un slot (×1,5 par changement du même
slot dans le cycle), le cycle clos devient un skin NFT (SVG rendu onchain) mis aux enchères en $SHED ; 50 % de
l'enchère gagnante est brûlé, 50 % réparti pro-rata aux sculpteurs du cycle. Airdrop de démo, journal onchain
borné (64 entrées) + événements NEP-297. Front Vite/TS. Simulation 60 cycles. Démo sandbox locale.

**Pourquoi.** Le jury de la track juge la mécanique, pas le chart : tout est dans le contrat, sans backend ni
clé admin, paramètres lisibles via `config()`.

**Cheminement.**
- Enchères en $SHED plutôt qu'en NEAR : le brûlage est direct (pas de buyback via DEX) et tout reste interne
  au contrat, sans appel cross-contract ni callback.
- Un seul contrat FT + NFT plutôt que deux : burns, escrows et transferts de skins sont des mutations d'état
  locales, aucune surface de réentrance.
- Pas de keeper : chaque méthode mutante « rattrape le temps » (`advance`), `shed()` est public et sans effet
  si rien n'est dû. Cycles alignés sur un calendrier fixe (`genesis + n × durée`) pour des fins prévisibles.
- Parts des sculpteurs en *pull* (`claim_sculptor_share`) plutôt que distribuées en boucle : gas borné.
- Paliers de prix par slot (et non par compte) : les multi-comptes ne sculptent pas moins cher ; parts
  linéaires : se diviser en alts ne rapporte rien.
- Slots à variantes finies (pas d'upload) : rien à modérer.
- SVG stocké dans `media` (base64) plutôt qu'une URL : l'art ne dépend d'aucun serveur. Budget 4 kB testé.
- Paramètre de base choisi par simulation : 10 000 SHED (0,001 % de l'offre) → ~12 % brûlés en 60 jours pour
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
- Test e2e : débordement u128 dans le calcul attendu de la part de Bob, recalculé en SHED entiers.
- Navigateur headless géré par l'outil : captures d'écran bloquées, contourné en mode `headed`.

## 2026-11-03 — Revue sécurité du contrat

**Quoi.** Revue par un agent reviewer (aucun P0/P1) puis correctifs : stockage prépayé par les appelants
(`transform_deposit`, `airdrop_deposit`), garde « le compte du contrat ne peut ni sculpter, ni enchérir, ni se
désinscrire », un meilleur enchérisseur ne peut pas se désinscrire, relancer sa propre enchère ne met en séquestre
que la différence, `shed_pending` vrai seulement si un skin est dû. Front adapté (dépôts lus dans les vues).

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
Déploiement de test `molt-lobster-test.testnet` (ancien nom) (cycles de 3 min) et script `scripts/smoke_testnet.py` qui joue
une partie complète sur testnet. Bot d'annonces X hors chaîne (dossier `bot/`, sans clé NEAR).

**Pourquoi.** Idée d'Armand : rendre la modification visible et statutaire (« c'est moi le visage de $SHED »), et
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

## 2026-11-12 — Renommage SHED, collection Exuviae, démo testnet

**Quoi.** MOLT → SHED partout ($MOLT existait déjà : memecoin Moltbook sur Base, même animal). Collection burn
« Exuviae » sur le sous-compte `exuviae.<contrat>` : chaque `transform` qui brûle le face de quelqu'un lui minte une
exuvie permanente (look, durée du règne, successeur). Rendu partagé dans `contract/art/`. Démo `shedcoin.testnet`.

**Pourquoi.** Idée d'Armand : celui qui se fait détrôner garde une trace transférable, donc chaque bagarre laisse un
objet de collection des deux côtés. Le sous-compte prouve que la collection appartient au projet.

**Cheminement.** Contrat séparé plutôt que des NFT `exuvia-n` dans le même contrat (les marketplaces regroupent par
contrat). Appel inter-contrats détaché : si le mint échouait, la transformation reste valide. Le stockage de l'exuvie
est prépayé par le nouveau sculpteur dans `transform_deposit`.

**Bugs & fix.**
- Collision de symboles wasm (`contract_source_metadata`, `new`, `nft_token`) entre les deux crates : exports de
  l'Exuviae écrits à la main (`exuviae_new`, `mint`, `exuviae_nft_token`), sans `#[near(contract_state)]`.
- Clés de stockage partagées entre les maps du NFT et celles du contrat (état corrompu, `Unreachable`) : préfixes
  distincts.
- Faille trouvée avant verrouillage : l'export `exuviae_new` réécrivait l'état sans contrôle, n'importe qui pouvait
  se déclarer `minter`. Gardes `state_exists` + appelant = le compte lui-même, test e2e de l'attaque, redéployé.
- Le contrat principal payait le stockage de chaque exuvie : ajouté à `transform_deposit` (test).
- Push GitHub bloqué par 600 Mo de `target/` commités : retirés du commit non poussé, `.gitignore` corrigé.
- L'étape ABI de cargo-near plante sur ce macOS (dylib) : build avec `--no-abi`.

## 2026-11-13 — Bot X en production, vidéo de démo

**Quoi.** Le bot poste pour de vrai sur @LobsterShed depuis le serveur (Docker durci, lecture seule de la chaîne).
Vidéo de démo de 76 s enregistrée sur la démo testnet (navigateur headless + transactions réelles), voix off locale.

**Pourquoi.** Le post X de démo est obligatoire pour la soumission ; le bot montre la mécanique vivre sans nous.

**Cheminement.** L'app X appartenait au compte développeur perso (« stoke ») : le bouton « Générer » de la console
aurait produit un jeton pour ce compte-là. Plutôt que de racheter des crédits sur un autre compte, flux OAuth 1.0a
PIN (`bot/src/authorize.ts`) : @LobsterShed autorise l'app, le script écrit le jeton dans le fichier de clés sans
l'afficher. Voix : `say` macOS trop robotique, service en ligne écarté (texte et compte tiers) → Kokoro en local,
transcription Whisper pour vérifier mots et calage.

**Bugs & fix.**
- 401 « Could not authenticate you » : le Client Secret OAuth 2.0 avait été mis à la place de l'API Key Secret.
- 403 X : « maximum of one cashtag » ; les annonces répétaient `$SHED`. Seul le premier garde le `$`
  (`singleCashtag` dans `compose.ts`, test dédié). Vérifié en prod : les annonces de fin de cycle passent.

## 2026-11-13 — Page hébergée et RPC en failover (retour d'un juge IA simulé)

**Quoi.** Front publié sur GitHub Pages ; lectures RPC en failover sur 4 endpoints publics testnet ; skins des
enchères chargés une seule fois ; pas de polling quand l'onglet est caché. README : lien vers la page, la vidéo, le bot.

**Pourquoi.** Retour : « RPC UNREACHABLE » chez un relecteur (limite de débit de fastnear) et pas de page publique.

**Cheminement.** Reproduit : notre IP était limitée par fastnear (429 sans en-têtes CORS, donc vu comme une erreur
CORS par le navigateur). Endpoints de docs.near.org testés un par un (CORS + appel de vue) : drpc, zan, intea OK ;
rpc.testnet.near.org déprécié (429), lava arrêté. `FailoverRpcProvider` de near-api-js plutôt qu'un code maison.
Vérifié avec fastnear limité : la page bascule sur zan et charge tout (mascotte, 6 exuvies, pas de bannière).

## 2026-11-13 — Photo de profil du bot = mascotte en direct

**Quoi.** Le bot remplace la photo de profil de @LobsterShed par la mascotte dès que son look change (max 1/min).

**Pourquoi.** Demande d'Armand ; le compte X devient un miroir visible de l'état onchain.

**Cheminement.** On avait conclu « impossible » en ne regardant que l'API v2. Testé en vrai : l'endpoint v1.1
`account/update_profile_image` accepte nos jetons OAuth 1.0a (200). Module `avatar.ts` séparé de l'annonceur (un
échec n'empêche jamais d'avancer le curseur), SVG comparé au dernier envoyé, échec réessayé après l'intervalle.
Test wallet réel (Meteor) réussi : airdrop + transform, face-9 au testeur. Le « Failed to fetch » de Meteor venait
de la limite fastnear sur notre IP partagée ; la transaction était passée (vérifié onchain).

## 2026-11-13 — CI GitHub Actions

**Quoi.** `.github/workflows/ci.yml` à chaque push/PR : fmt + clippy `-D warnings` + tests unitaires des trois crates,
build des deux wasm, test e2e sur sandbox NEAR, tests du bot, build du front. Badge dans le README.

**Pourquoi.** Rendre « 97 tests + e2e » vérifiable par un juge sans rien installer.

**Bugs & fix.** Le crate `art` n'avait jamais exécuté ses propres tests : sans `near-sdk` en dev-dependency avec
`unit-testing`, `cargo test` y échouait à la compilation (ses 8 tests ne tournaient que via rien). Ajouté, plus un
formatage et un `items_after_test_module` clippy corrigés. Premier run CI vert (contrats ~12 min avec le sandbox).
