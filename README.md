# Lanebreak (prototype v0.9)

Real-time lane card battler on floating sky islands. Online 1v1 (ranked, casual, friends),
accounts with Glicko-2 ratings, a leaderboard, and practice against a bot. A deterministic
simulation runs on the server (the real match) and in each browser (to draw it).

## Run it locally

```bash
npm install
npm test          # rules, ratings, determinism, anti-cheat, accounts, live online tests
npm run dev       # builds and starts the server on http://localhost:8080
```

Without `DATABASE_URL` the server keeps accounts in memory (fine for local testing, wiped on restart).
To test against Postgres: `DATABASE_URL=postgres://user:pass@localhost:5432/db npm run dev`,
and `TEST_DATABASE_URL=... npm test` runs the online tests against it.

`npm run sim -- 200` plays 200 bot-vs-bot matches and prints the win split, card usage and sim speed.

Requires Node 20+.

## Deploy on Railway

1. In the Railway project: **+ Create → Database → PostgreSQL**.
2. Open the **lanebreak** service → **Variables** → **+ New Variable** → **Add Reference** →
   pick `DATABASE_URL` from the Postgres service. Railway redeploys.
3. Check `https://<your-domain>/health` says `"database":"postgres"`.

The server creates its tables on startup. Keep the service at **one replica** (live matches are in
memory). Redeploying ends matches in progress. Never set `LB_TEST_SPEED` (tests only).

Endpoints: `/health`, `/api/stats`, `/api/leaderboard`, `/api/players/<name>`, `/api/matches/<CODE>`
(seed + input log of a finished match, enough to replay it exactly).

## Layout

```
src/sim/          rules engine (sim.ts), cards, seeded RNG — shared by server and client
src/ai/bot.ts     practice opponent; sends inputs exactly like a player would
src/net/          wire protocol + ranked tiers (shared)
src/server/       server.ts (rooms, queues, game loop, HTTP API), store.ts (Postgres / memory),
                  auth.ts (scrypt passwords, sessions), glicko.ts (ratings)
src/client/       main.ts (flow + networking), render.ts (arena, effects), unitSprites.ts +
                  spriteCache.ts (painted unit sprites, cross-faded animation), characters.ts/sprites.ts
                  (code-drawn fallback characters, towers), portraits.ts (card art), deck.ts,
                  audio.ts (synth sounds), account.ts (sign-in, leaderboard)
assets/cards/     painted card portraits; assets/units/ painted views (front/side/back);
                  assets/anim/ walk + attack frames; assets/towers/ tower skins
test/             sim, rating, and end-to-end online tests
```

## Cards and decks

16 cards; a deck is any 8 different ones. Decks are saved in the browser and, when signed in, to the
account (`PUT /api/deck`). Every match request carries the player's deck; the server validates it and
falls back to the starter deck if it's invalid. Both players' card order comes from the same seed, so
draws are equally lucky even with different decks. `npm run sim -- 400 random` plays random-deck
bot matches and prints each card's win rate (a rough balance signal: bots play some cards badly).

## Ranked

- Glicko-2 ratings, starting at 1500. New players' ratings move fast (high uncertainty) and settle
  as they play; uncertainty grows again after time away.
- 5 placement matches, then a tier: Breeze < 1300 ≤ Gale < 1500 ≤ Storm < 1700 ≤ Thunder < 1900 ≤
  Tempest < 2100 ≤ Skyborn.
- Matchmaking pairs the closest ratings; the allowed gap starts at ±100 and widens while waiting.
- One live match and one ranked search per account. Leaving or staying disconnected for 20s is a loss.
  A match where both players vanish is voided (no rating change).
- Casual and friend matches never change ratings.

## Security notes

- Passwords: scrypt with per-user salt. Sessions: random 256-bit tokens; only their SHA-256 is stored.
- Login/sign-up are rate limited per IP and per username; unknown users take as long as wrong passwords.
- Clients only send "play card X at tile (x, y)"; the server's sim validates every move. Messages are
  size-capped and rate-limited, and every 100 ticks clients prove their state matches the server's.

## Rules in this version

3:00 regulation, double aether in the last minute, 1:00 sudden death, then a tiebreak on the
weakest remaining tower. Destroying a side tower unlocks deploys in that lane on the enemy side.
Troops can be placed anywhere on your island except on a tower's own tile (right behind or beside
towers is fine).
The king's keep wakes up when hit or when a side tower falls. Both players get the same card order.
