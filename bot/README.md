# SHED X announcer bot

An off-chain bot that mirrors SHED onchain activity on X (Twitter). It is **cosmetic**: the game works the same
whether the bot runs or not, and the bot never holds NEAR keys or signs NEAR transactions. It only reads public
contract views over JSON-RPC and posts with the bot account's X credentials.

## What it posts

It polls `journal({ limit: 64 })` (finality `final`) every `POLL_SECONDS` and handles entries newer than its cursor:

| journal entry | post | image |
| --- | --- | --- |
| `shed` | immediately: "Cycle N is over. Skin #k is frozen and up for auction…", SHED burned, closing time, burn share | the skin |
| `settle` | immediately: sold to X for Y SHED (Z burned, rest to sculptors), or "no bids: goes to the top sculptor" | the skin |
| `transform` | batched, at most one post per `MIN_POST_INTERVAL_SECONDS`: who changed what, total burned, face holder | the live mascot |
| `bid`, `airdrop`, `sculptor_claim` | ignored | — |

The bot account's **profile picture is the live mascot**: each poll compares the mascot SVG with the last one uploaded
and replaces the picture when the look changed (at most once a minute).

Images are the contract's own 32×32 SVGs rendered to 1024×1024 PNGs with hard pixel edges. Texts stay under X's
280 weighted characters (long change lists are folded into "…N earlier").

On the very first start (no state file) the cursor is set to the newest journal entry and nothing is posted, so an
existing backlog never floods the timeline. Delivery is at-least-once: a crash between a post and the cursor save may
repeat one post; a post rejected by X is logged (status + body) and not retried.

## Layout

```
src/
  config.ts     env parsing/validation (fails fast, lists every problem)
  chain.ts      read-only NEAR RPC view calls (finality final)
  decode.ts     unknown JSON → typed values (RPC and X responses)
  events.ts     cursor rules: strictly newer entries, gap detection, batch timing
  compose.ts    post texts       format.ts  amounts, accounts, X length counting
  render.ts     SVG → 1024 px PNG (resvg), refuses SVGs that could pull outside content
  oauth1.ts     OAuth 1.0a HMAC-SHA1 signing (node:crypto)
  x.ts          X API v2: media upload + create post
  publish.ts    dry-run (files) or X publisher
  state.ts      cursor + pending batch, atomic writes (temp file + rename, mode 0600)
  announcer.ts  one poll step       main.ts  wiring, poll loop, SIGTERM/SIGINT
deploy/shed-bot.service   hardened systemd unit
Dockerfile                container alternative
```

## Commands

```bash
npm install
npm run build      # tsc → dist/
npm test           # node:test (OAuth vector, compose limits, cursor/batching, config, state, render)
```

## Run a dry run first

`DRY_RUN` defaults to `true`: the bot never calls X and writes each would-be post as `OUT_DIR/<timestamp>-<n>-<kind>.json`
plus the matching `.png`.

```bash
DRY_RUN=true SHED_CONTRACT_ID=shedcoin.testnet SHED_RPC_URL=https://test.rpc.fastnear.com \
  STATE_FILE=/tmp/shed-bot-state.json node dist/main.js
```

To replay the journal currently onchain once (useful to preview every template), stop the bot and write a cursor of
0 by hand, then start it again:

```bash
echo '{"cursor_ns":"0"}' > /tmp/shed-bot-state.json
```

Logs are JSON lines on stdout (`LOG_LEVEL`: `debug`, `info`, `warn`, `error`).

## Configuration

See [.env.example](.env.example). Required: `SHED_CONTRACT_ID`, `SHED_RPC_URL` (https), `STATE_FILE`. Optional:
`POLL_SECONDS` (30, min 5), `MIN_POST_INTERVAL_SECONDS` (1800), `OUT_DIR` (`out`), `DRY_RUN` (`true`), `PUBLIC_URL`
(https, appended to every post), `LOG_LEVEL` (`info`). `X_CONSUMER_KEY`, `X_CONSUMER_SECRET`, `X_ACCESS_TOKEN`,
`X_ACCESS_SECRET` are required only when `DRY_RUN=false`. An invalid configuration exits with code 78 (systemd does
not restart it).

## Threat model

- **No NEAR keys.** The bot only calls view methods. A compromised bot cannot move tokens, bid, sculpt or touch the
  contract (which has no admin anyway). Never put a NEAR key in its environment.
- **Secrets held:** the four X OAuth 1.0a values of the bot account, nothing else. They are never logged; X error
  bodies are logged, request headers are not.
- **Network:** outbound HTTPS only (NEAR RPC + `api.x.com`). No listening port, no inbound traffic.
- **Untrusted input:** RPC responses are validated field by field; SVGs containing images, links, entities, `<use>`,
  `<text>` or `url(` are refused before rendering, so a hostile RPC cannot make the bot render local files into a
  public post. Post texts only contain contract data that is already public.
- **If the server is compromised**, the attacker gets the X credentials and can post, delete or otherwise act as the
  bot account (and spend the X API credit balance) until you revoke them; they get nothing on NEAR. Response:
  regenerate the access token and secret (and the consumer key if exposed) in the X Developer Console, check the
  account's recent posts, rotate the server.
- **Limits of the sandbox:** the systemd unit runs the bot as a dedicated user with a read-only system, no home
  access, a private `/tmp`, no capabilities and write access to `/var/lib/shed-bot` only. The env file is read by
  systemd as root (mode 0600, root-owned), but the running process can still read its own environment: hardening
  limits what else an attacker reaches, it does not hide the X credentials from code running as the bot.
- **Cost abuse:** the batch interval and the per-event policy bound the post rate. Set a low auto-recharge or none in
  the X console so a compromise cannot drain a large balance.

## X developer setup (OAuth 1.0a, read + write)

1. Create (or pick) the X account that will post, ideally a dedicated bot account, and enable 2FA on it.
2. Sign in to [console.x.com](https://console.x.com) **with that account**, accept the Developer Agreement and create
   an app. The console's "Access Token & Secret" act as the account that owns the app, so owning the app with the bot
   account is the simplest path.
3. In the app's user authentication settings, set app permissions to **Read and write** *before* generating the access
   token. A token generated while the app was read-only stays read-only: regenerate it after changing permissions.
4. Copy the **API Key & Secret** (`X_CONSUMER_KEY`, `X_CONSUMER_SECRET`) and generate the **Access Token & Secret**
   (`X_ACCESS_TOKEN`, `X_ACCESS_SECRET`). They are shown once; store them in a password manager.
   If the app belongs to another account, do not generate the token in the console (it would act as the app owner):
   put the two consumer keys in an env file and run
   `node --env-file=<keys.env> dist/authorize.js <keys.env>` (PIN-based OAuth). Open the printed link while logged in
   as the bot account, authorize, type the PIN; the script appends the access token and secret without printing them.
5. Buy credits in the console (see cost below), then set `DRY_RUN=false`.

The bot uses `POST https://api.x.com/2/media/upload` (JSON, base64, `media_category: tweet_image`) and
`POST https://api.x.com/2/tweets` (`text` + `media.media_ids`), both signed with OAuth 1.0a (HMAC-SHA1). X rejects a
post with more than one cashtag, so only the first `$SHED` keeps its `$`. The profile picture follows the live
mascot through `POST https://api.x.com/1.1/account/update_profile_image.json` (v2 has no such endpoint), at most once
a minute and only when the look changed.

## Cost (pay-per-use)

The X API has no free tier: you buy credits and each request is charged. At the time of writing
([docs.x.com pricing](https://docs.x.com/x-api/getting-started/pricing.md)) **"Post: Create" costs $0.015 and
"Post: Create (with URL)" costs $0.200**, so setting `PUBLIC_URL` makes every post about 13× more expensive. Media
upload is not listed separately on that page; check the console for current rates.

Rough budget: one `shed` and one `settle` post per sculpted cycle, plus at most `86400 / MIN_POST_INTERVAL_SECONDS`
transform summaries per day (48 with the default 30 minutes). With daily cycles and no link that is at most about
50 posts/day ≈ $0.75/day; with `PUBLIC_URL` about $10/day. Testnet-style 3-minute cycles post far more: keep those in
dry-run.

## Run on a Linux server with systemd

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin shed-bot
sudo mkdir -p /opt/shed-bot /etc/shed-bot
sudo cp -r package.json package-lock.json tsconfig.json src /opt/shed-bot/
cd /opt/shed-bot && sudo npm ci && sudo npm run build && sudo npm prune --omit=dev
sudo install -m 0600 -o root -g root .env.example /etc/shed-bot/shed-bot.env   # then edit it
echo 'STATE_FILE=/var/lib/shed-bot/state.json' | sudo tee -a /etc/shed-bot/shed-bot.env
echo 'OUT_DIR=/var/lib/shed-bot/out' | sudo tee -a /etc/shed-bot/shed-bot.env
sudo cp deploy/shed-bot.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now shed-bot
journalctl -u shed-bot -f
```

The code in `/opt/shed-bot` stays root-owned and read-only for the bot. Adjust `ExecStart` if `node` is not at
`/usr/bin/node` (Node 22+). Check the sandbox with `systemd-analyze security shed-bot`.

## Docker alternative

```bash
docker build -t shed-bot .
docker run -d --name shed-bot --restart on-failure --read-only --cap-drop ALL \
  --security-opt no-new-privileges --env-file ./shed-bot.env \
  -v shed-bot-data:/data shed-bot
```

`shed-bot.env` is a copy of `.env.example` (mode 0600) without `STATE_FILE`/`OUT_DIR`, which the image sets.

The image is multi-stage (no dev dependencies or sources in the final layer), runs as the non-root `node` user, and
only writes to the `/data` volume (`STATE_FILE=/data/state.json`, `OUT_DIR=/data/out`), so it works with `--read-only`.
