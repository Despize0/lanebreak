# Lanebreak (prototype v0.2)

Real-time lane card battler with online 1v1. A deterministic game simulation runs on the server
(the real match) and in each browser (to draw it). Practice mode against a bot works offline.
No accounts, no money yet.

## Run it locally

```bash
npm install
npm test          # rules, determinism, anti-cheat, and live online tests
npm run dev       # builds and starts the server on http://localhost:8080
```

Open http://localhost:8080 in two browser windows (or two devices on your Wi-Fi) and click
**Find match** in both, or **Play a friend** in one and open the invite link in the other.

`npm run sim -- 200` plays 200 bot-vs-bot matches and prints the win split, card usage and sim speed.

Requires Node 20+.

## Deploy on Railway

1. Push this folder to a new GitHub repo.
2. In Railway: **New Project → Deploy from GitHub repo** and pick it.
   Railway runs `npm install`, `npm run build`, then `npm start` on its own.
3. In the service: **Settings → Networking → Generate Domain**.
4. Open that domain. Share links look like `https://<your-domain>/?room=ABCDE`.

Keep it at **one replica**: live matches live in the server's memory. Redeploying ends any matches
in progress, so deploy when nobody is playing. Do not set `LB_TEST_SPEED` (tests only).

Useful endpoints: `/health`, `/api/stats` (live matches, queue size), `/api/matches/<CODE>`
(seed + full input log of a finished match, enough to replay it exactly).

## Layout

```
src/sim/sim.ts       the whole game rules engine (runs on server AND client)
src/sim/cards.ts     the 8 original cards and their stats; tune balance here
src/sim/rng.ts       seeded RNG (the sim never uses Math.random)
src/ai/bot.ts        practice opponent; sends inputs exactly like a player would
src/net/protocol.ts  every message the client and server can send
src/server/server.ts match server: queue, private rooms, game loop, reconnects
src/client/          browser page, renderer, touch controls
test/                sim tests + end-to-end online tests (real server, real sockets)
```

## How online play works

- The server owns the match. Each 1/20s it applies the inputs it received, steps the sim, and
  sends both players a frame: the tick number plus those inputs.
- Clients only ever send "play card X at tile (x, y)". They never send positions, damage or elixir.
  The server's sim rejects anything illegal: card not in hand, not enough elixir, wrong side,
  non-integer or out-of-bounds coordinates. Messages are size-capped and rate-limited.
- Clients run the same deterministic sim on the frames, so their screen matches the server exactly.
  Every 100 ticks each client reports a state hash. If it differs (a bug or a tampered client),
  the server sends the full log and the client rebuilds the real state.
- Disconnects: the match keeps running; the player has 20 seconds to come back (refreshing the page
  rejoins automatically). After that it's a forfeit. Leaving the match is a resignation.
- Every finished match is stored with its seed and input log, so the result can be re-simulated
  and checked by anyone. Both clients also do this at the end and show "Matches server result".

## Rules in this version

3:00 regulation, double elixir in the last minute, 1:00 sudden death, then a tiebreak on the
weakest remaining tower. Destroying a side tower unlocks deploys in that lane on the enemy side.
King tower wakes up when hit or when a side tower falls. Both players get the same card order.

## Next steps

1. Accounts, Glicko-2 ranked queue, leaderboard (needs a database).
2. Persist match records to the database instead of memory.
3. Cash mode only after anti-cheat is proven and the legal/payment structure is approved.
