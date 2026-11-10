# MOLT — design

The memecoin that sheds its skins. Track: **Memecoins With Mechanics** (`memecoins`).

## The rule

1. **$MOLT** is an NEP-141 token. The whole supply is minted once at launch; nothing ever mints again.
2. A public mascot (a 32×32 pixel-art lobster) has 6 trait slots: `background`, `shell`, `pattern`, `eyes` (the
   face: eyes + mouth), `claws`, `headgear`. Each slot has a fixed, finite list of variants decided at launch (no
   free text, no uploads → no moderation problem). Variants are hand-drawn sprite sheets compiled into the
   contract (`contract/src/render/sprites/*.txt`); the shell slot recolours the body.
3. **Sculpting.** During a cycle, any holder calls `transform(slot, variant)`. The price is **burned**.
   Price of a slot = `base_transform_price × (price_growth_bps / 10000) ^ k`, where `k` = number of
   changes already made to *that slot* during the current cycle. Fighting over a slot gets expensive fast.
   Every burned token is recorded as the caller's *contribution* to the cycle.
   Each change also mints the **face** NFT (`face-<n>`) to the caller and burns the previous face (NEP-171
   `nft_burn` event): exactly one face exists, held by the last sculptor. Faces cannot be transferred or
   approved, their `media` is computed on read from the live genome, and `mascot().face` names the holder.
4. **Molt.** Cycles are aligned on a fixed schedule (`genesis + n × cycle_duration`). When a cycle ends and it had
   at least one transformation, its final appearance is frozen into a unique NEP-171 NFT (**skin**), with the SVG
   rendered and stored onchain. The mascot keeps its look and the next cycle starts from it. A cycle with no
   transformation produces no skin.
5. **Auction.** Each new skin is auctioned in $MOLT for `auction_duration`. Bids are escrowed in the contract;
   outbid tokens are refunded immediately. A bid in the last `anti_snipe` window extends the auction to `now + anti_snipe`.
6. **Settlement.** Winning bid: `auction_burn_bps` is **burned**, the rest becomes the *sculptor pool* of that skin,
   claimable pro-rata to contributions by the sculptors of the cycle (`claim_sculptor_share`). No bid: the skin goes
   to the cycle's top sculptor and nothing is burned.
7. **No admin.** All parameters are passed to `new` once and exposed by `config()`. There is no owner, no pause, no
   upgrade method. After deploy the contract account's full-access key is deleted.
8. **Keeper-free.** Every mechanic call (`transform`, `bid`, `claim_*`, `molt`) first advances time (settles
   finished auctions, closes finished cycles). `molt()` does only that, callable by anyone.
9. **Storage is prepaid by callers.** The first `transform` of a cycle prepays the future skin (7 kB budget), each
   new sculptor of a cycle prepays their contribution entry, `claim_airdrop` prepays its record. Excess is refunded.
   The contract account itself cannot sculpt, bid or unregister; highest bidders cannot unregister.

Burn sources: transformations (100 %) and auctions (`auction_burn_bps`). Supply can only go down.

## Sybil & abuse notes (also in README)

- Contributions are linear: splitting into many accounts gives no extra sculptor share.
- Slot prices are per slot, not per account: alts cannot sculpt cheaper.
- The airdrop (`claim_airdrop`, fixed amount once per account from a fixed pool) exists for the testnet demo and is
  trivially sybil-able. A mainnet launch would set `airdrop_pool = 0`.
- A sculptor can bid on their own skin: half of the bid still burns. That is a burn, not an exploit.
- Last-second sniping is limited by the anti-snipe extension, not eliminated.
- Storage budgets are upper bounds tested against the largest SVG and 64-character accounts. The contract only
  pays for the bounded journal (64 entries).

## Contract API (JSON)

Amounts are yocto-MOLT strings (`U128`, 18 decimals). Times are nanoseconds (`U64` strings). `Slot` is one of
`"background" | "shell" | "pattern" | "eyes" | "claws" | "headgear"`.

### Init

`new({ config })` with `config`:

| field | type |
| --- | --- |
| `initial_holder` | AccountId — receives `total_supply - airdrop_pool` |
| `total_supply` | U128 |
| `airdrop_pool`, `airdrop_amount` | U128 |
| `cycle_duration_ns`, `auction_duration_ns`, `anti_snipe_ns` | U64 |
| `base_transform_price` | U128 |
| `price_growth_bps` | u32 (≥ 10000) |
| `min_bid` | U128 |
| `min_bid_increment_bps` | u32 |
| `auction_burn_bps` | u32 (≤ 10000) |

### Calls

| method | deposit | returns | effect |
| --- | --- | --- | --- |
| `transform({ slot, variant })` | `transform_deposit` (≥ 1 yocto) | U128 burned | burn slot price, set trait |
| `bid({ skin_id, amount })` | 1 yocto | — | escrow bid (only the difference when raising your own), refund previous bidder |
| `claim_sculptor_share({ skin_id })` | — | U128 | pay caller's pro-rata share |
| `claim_airdrop()` | `airdrop_deposit` | U128 | one-time airdrop (caller must be storage-registered) |
| `molt()` | — | bool | advance cycles/auctions; `true` if something changed |

Plus NEP-141 (`ft_*`), NEP-145 (`storage_*`), NEP-148 (`ft_metadata`), NEP-171/177/178/181 (`nft_*`).

### Views

| method | returns |
| --- | --- |
| `config()` | config + `genesis_ns` |
| `catalog()` | `[{ slot, variants: [name] }]` |
| `mascot()` | `{ cycle, cycle_ends_at_ns, molt_pending, genome, svg, slot_prices, slot_changes, cycle_burned, top_sculptor }` |
| `preview_svg({ slot, variant })` | SVG string of the current mascot with one trait swapped |
| `skin({ skin_id })` / `skins({ from_index, limit })` | `{ skin_id, cycle, genome, svg, owner_id, auction }` |
| `auctions()` | open auctions `{ skin_id, ends_at_ns, highest_bidder, highest_bid, min_next_bid, settled }` |
| `sculptor_claimable({ skin_id, account_id })` | U128 |
| `contribution({ cycle, account_id })` | U128 |
| `stats()` | `{ initial_supply, total_supply, burned_by_transform, burned_by_auction, skins_minted, airdrop_remaining }` |
| `journal({ limit })` | newest-first log of transforms, molts, bids, settlements, claims |
| `airdrop_claimed({ account_id })` | bool |
| `transform_deposit({ account_id })` | U128 yoctoNEAR to attach to that account's next `transform` |
| `airdrop_deposit()` | U128 yoctoNEAR to attach to `claim_airdrop` |

`genome` is an object `{ background, shell, pattern, eyes, claws, headgear }` of variant indices.
