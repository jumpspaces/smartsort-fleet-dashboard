# SmartSort Fleet Dashboard

JumpSpaces-internal monitor for deployed SmartSort POS terminals. A standalone
SPA that reads the cloud droplet's `/fleet/*` endpoints — it is **not** part of
the app shop owners run, and it never touches shop-user auth.

## How it fits together

Each installed desktop terminal runs a **fleet reporter** (`admin/electron/fleet-reporter.ts`)
that POSTs a heartbeat + buffered client errors to `POST /fleet/report` on the
shared cloud droplet every ~3 minutes. The server (`server/src/routes/fleet.ts`)
upserts one `device_report` row per install, **appends** a `device_report_history`
beat, and folds errors into both `error_event` (per device) and `error_group`
(fleet-wide). This dashboard renders those feeds.

```
desktop terminals ──POST /fleet/report──▶  cloud droplet (server/)
                                                │  snapshot + history + errors
this dashboard   ──GET /fleet/devices────▶─────┤
                 ──GET /fleet/errors─────▶     │  alert evaluator ──▶ webhook
                 ──GET /fleet/alerts─────▶─────┘  (every 60s)
```

## Server setup

On the droplet's server env (`server/.env`):

```
FLEET_REPORT_SECRET=<openssl rand -hex 24>   # enrollment key, baked into the desktop build
FLEET_ADMIN_SECRET=<openssl rand -hex 24>    # enables the vendor surface; signs operator sessions

# Optional — where alerts are pushed. Any JSON webhook: Slack, Discord, or a
# two-line relay in front of an SMS provider.
FLEET_ALERT_WEBHOOK_URL=https://…
FLEET_ALERT_WEBHOOK_SECRET=<openssl rand -hex 24>   # sent as X-Fleet-Signature

# Optional but strongly recommended — the dead-man switch. The server pings this
# after every successful evaluation pass; an external watcher (healthchecks.io,
# Cronitor, Uptime Kuma push) alerts when the pings STOP. It is the only signal
# that survives the droplet dying — from inside, a dead server and a healthy
# fleet both produce silence.
FLEET_HEARTBEAT_URL=https://hc-ping.com/…

# Optional — Prometheus scrape token for GET /fleet/metrics.
FLEET_METRICS_TOKEN=<openssl rand -hex 24>

# Optional — retention windows (defaults shown).
FLEET_HISTORY_RETENTION_DAYS=14    # raw 3-minute beats
FLEET_ROLLUP_RETENTION_DAYS=400    # daily rollups
FLEET_AUDIT_RETENTION_DAYS=400     # who did what
```

Then **create at least one operator account** — nobody can sign in until you do:

```
cd server
npm run db:migrate                                                  # once, for the fleet tables
npm run fleet:operator -- add you@jumpspaces.co "Your Name" --role admin
npm run fleet:operator -- list
```

On the droplet the same command runs inside the container:

```
docker compose exec server npm run fleet:operator -- add you@jumpspaces.co "Your Name" --role admin
```

> `FLEET_ADMIN_SECRET` is no longer a password. It gates whether the control
> plane exists and derives the session-signing key, so **rotating it signs every
> operator out** — that is the break-glass switch.

Bake `FLEET_URL` and the same `FLEET_REPORT_SECRET` into the desktop build:

```
FLEET_URL=https://cloud… FLEET_REPORT_SECRET=… npm --prefix admin run electron:package
```

## Run the dashboard

```
npm install
npm run dev        # http://localhost:5180
npm test           # unit tests
# or: npm run build && npm run preview
```

Sign in with your operator email and password. In dev the server address
starts empty; enter it under "Server" on the sign-in screen. Optionally bake a default URL
with `VITE_FLEET_API=https://cloud…` at build time.

## Auth model

Three credentials, none of them a shop JWT:

- **Claimed terminals** report with their own per-machine store key
  (`X-Store-Key`, minted at claim, revocable from the Shops view). The cloud
  takes the device and shop identity **from the key**, not from the request body.
- **Unclaimed terminals** report with the shared `FLEET_REPORT_SECRET`
  (`X-Fleet-Key`). That secret is baked into every installer, so it is treated as
  an *enrollment* credential only: once a machine is claimed the cloud refuses
  it, and any device still using it is flagged `unverified` in the UI.
- **Operators** sign in with their own email and password and receive a 30-minute
  access token plus a 12-hour refresh token. Accounts can be disabled
  individually (`fleet:operator -- disable`), and **every mutation is written to
  `fleet_audit_log`** — who provisioned which shop, who revoked which key, who
  resolved which crash. Read it at `GET /fleet/audit`.

Roles: `viewer` reads, `operator` acts, `admin` also manages accounts.

**Sign-in codes.** Any operator can add a code from an authenticator app
(Settings → Team → Your sign-in codes): password, scan, first code, then ten
one-time recovery codes shown once. The secret is sealed with `SECRETS_KEY`; a
code is never accepted twice. An admin who uses codes can require them of
everyone, after which a session without one can only set them up. Lost phone
and recovery codes: an admin clears them (Team → Clear codes), or on the server
`npm run fleet:operator -- reset-2fa <email>`.

**Closing a shop.** Shop → Data & closing. Download all its data for the owner
(a zip of CSVs, credentials left out). Closing it (password) refuses its tills'
sync, check-ins and claims and its staff's cloud sign-in, and takes its tills
out of the console — nothing is deleted, and reopening undoes it. Its data is
deleted no sooner than 30 days later, and only after a **second** operator
agrees; `shop_closure` keeps the record of who, when and how many rows. A
one-operator team has to add a second account before anything can be deleted.

**Moving the cloud.** Settings → Tills → Cloud address takes a move signed with
the release key by the "Move tills to a new cloud address" workflow — see
`server/DEPLOY.md`. The server delivers moves; it cannot make one.

## What decides "healthy"

`server/src/lib/fleet-health.ts` is the single definition, computed server-side
because two of its inputs are database questions — a 24-hour window, and whether
an error group is still **open** after triage. The dashboard renders `state` and
`reasons`; it does not derive them.

A terminal is **attention** only when something a working till does not do is
true: a sync that *failed*, a queue deeper than 25 or stuck for 15 minutes, a
downed local server, or an open error seen in the last 24 hours. A queue of three
rows mid-flight is healthy, and resolving a bug clears every terminal it was
holding amber.

## Alerting

The evaluator runs every 60 seconds and opens **one** alert per condition per
terminal (`device.offline`, `server.down`, `sync.failed`, `sync.stuck`,
`sync.deep`, `errors.spike`, `errors.new_group`, `sales.flatline`). Each is
notified once when it opens and once when it clears, so a flapping terminal
produces a page and an all-clear rather than a stream. Delivery state lives on
the row: an alert the webhook never accepted is shown as **not delivered**
instead of quietly looking handled.

## Remote actions

The console can act on a till, not only watch it. Delivery rides the existing
heartbeat — the terminal asks every ~3 minutes and the response carries whatever
is waiting — so there is no inbound port to a till behind a domestic router.

**Live mode.** While a till's page is open, the console renews a five-minute
lease (`POST /fleet/devices/:id/live`) and the report response tells that till
to check in every 15 seconds instead. The till switches at its next ordinary
beat; the page says when. Closing the page lets the lease lapse on its own.
Live beats are recorded in the history at most every 2½ minutes, so watching a
till does not inflate its uptime.

**What a till can be told to do:**

| | Commands |
|---|---|
| Fixes | force sync, report now, back up now, collect logs |
| Stuck rows | list what it can't apply or send (with the reason for each), retry them now, **discard one received row** |
| Its screen | show a plain-text message for N hours, take it down, **lock it** (paused by support / retired / missing), unlock it |
| Settings | heartbeat interval (1–15 min), backup interval (2–24 h) |
| Upkeep | restart the local server, check the database (reads every table), free disk space (old backups, unused app updates, the previous log) |
| Updates | install / undo a signed app version (from the Updates page) |

The command set is a fixed allowlist checked on **both** ends
(`server/src/services/fleet-commands.service.ts` and the switch in
`admin/electron/fleet-reporter.ts`, held together by `scripts/check-lockstep.mjs`).
There is no shell, no path and no URL in any payload — a stuck row is named by an
eight-character reference, a setting by its name and a bounded number.

Each till reports the commands its build understands; the console offers only
those and the server refuses the rest, so an old till is never sent something it
would answer "unknown command" to.

**How much each command can hurt decides what it takes to send it:**

- *Safe* — one click.
- *Disruptive* (restart, database check, settings) — can be held until the shop
  has gone 10 minutes without a sale ("when quiet"), or booked for a time up to a
  week ahead.
- *Destructive* (lock, discard a row) — needs the sender's **password again**,
  never goes out in bulk, and — with Settings → Team → "A second operator must
  approve them" — waits for a different operator to approve it with *their*
  password. A stolen session token cannot do either.

Commands expire (an hour by default), only one of each can be outstanding per
terminal (a newer message or setting replaces a waiting one; an unlock cancels a
waiting lock), and a device on the shared enrollment key is never sent any.

**A lock, a message and a setting are kept, not sent.** When one is due it is
saved to the till's *kept settings* (`till_setting`, see
`server/src/services/fleet-till-settings.service.ts`), and every check-in reply
carries the whole set back — so a lock waits however long a till is off, a
reinstalled till picks its settings straight back up, and a hand-edited
`fleet-control.json` is put back at the next check-in. The till echoes the
version it holds, which is how the till page says "the till has these" or
"saved, at its next check-in". Settings come in three levels, the most specific
winning key by key: **every till** (Settings → Tills), **a shop** (the shop's
Till settings tab) and **the till itself**. A lock only ever goes on one till.

**Held in the cloud.** Two controls are enforced by the cloud rather than asked
of the till, so they hold on a till that cannot be trusted to obey:

- *Sync paused* (password again) — the cloud answers the till's uploads and
  pulls with `423 sync_held`. Nothing is lost: its outbox keeps every row and
  sends when the pause is lifted. Its heartbeat is not paused, so it can still
  be locked; its queue raises no alerts while paused. Revoking a till's store key
  also stops sync, but stops its check-ins too, and with them any lock.
- *Kept out of updates* (a till, or a whole shop) — no operator and no rollout
  can send it a version; a rollout lists it as skipped, with the reason.

**Automatic fixes.** An alert rule can name one fix from a short list that suits
it (Settings → Alert rules): a stuck queue may run *Unstick sync*, a full disk
*Make room safely*, a dead local server a restart. It runs on the till when the
rule opens an alert there — once, not on every pass — waits for a quiet till if
it interrupts sales, and is not tried again for that rule and till for 6 hours
(4 a day per till in all), nor on a till whose alerts are muted. The alert says
what it did.

**Schedules** (Settings → Tills) queue ordinary commands on every till they
cover, daily or weekly at shop time: a Sunday database check, one shop's sync
unstuck nightly. Nothing destructive, no updates and no settings can be
scheduled; anything that interrupts trading always waits for a quiet till; tills
silent for a day are skipped. Each schedule shows what its last run did.

**The lock is a screen lock.** The till's own server keeps running under it, so
sales already rung still sync and the reporter keeps checking in — which is how
the unlock arrives. Someone with the machine and a terminal can still reach its
data; it is for holding a till out of service, not for defeating its owner. A
locked till does not trip the "no sales today" alert.

**Discarding is receive-side only.** A row this till *received* and cannot apply
still exists in the cloud and on the till that wrote it; the till backs itself up
before letting it go. A row this till *wrote* and the cloud refused may be the
only copy of a sale, so there is no remote command that throws one away.

## A shop's inventory

A shop's **Stock** tab is its inventory, not its machines: what the catalogue
holds, a download of any of its books, and a way to put inventory in on the
shop's behalf. Onboarding a corner shop includes
"send us your stock list and we'll load it", and doing that over the phone
through their own admin app was the only option before.

Downloads (`GET /api/stores/:shopId/export`) cover **products & stock**,
**sales**, **profit**, **tax**, **wastage** and **dead stock**, as CSV or PDF —
the same builder the shop's own Reports → Export uses, so the file a support
engineer opens is the file the owner sees. They read the cloud copy, so they
hold everything the shop's tills have synced and nothing a till is still
holding offline. Every download is audited.

Writes need the `operator` role and go through the same services as the shop's
own admin app: a products CSV, a stock-received CSV, one product, or one
delivery. Two things follow from the architecture and are worth knowing before
pressing the button:

- **They reach the tills on their own.** Nothing is special-cased downward. The
  ingest triggers announce a vendor-written row on the shop's change feed
  exactly like one that arrived from a till, and each terminal's pulldown
  applies it within about a minute. A shop that hasn't claimed a machine yet
  receives the same rows through `bootstrap` when it does — so a catalogue can
  be loaded *before* the shop has a till.
- **The shop's own stock log names the owner.** `stock_movement.actor_id` is a
  foreign key into that shop's staff and an operator is not one of them;
  inventing a shadow staff member to satisfy it would put a stranger in their
  team list. Who really did it lives in `fleet_audit_log`.

One trap the panel warns about in place: on the products import, `Stock
Quantity` against a product that already exists is **received**, not asserted —
so an exported sheet fed straight back doubles the shelf. Blank that column to
edit names and prices without moving stock.

## Watching the watcher

A monitor cannot alert on its own death. `GET /health/deep` answers 200 only
when the database answers and the evaluator finished a pass in the last five
minutes — point UptimeRobot at it (server/DEPLOY.md lists the monitors). Two
more outward-facing signals:
`FLEET_HEARTBEAT_URL` is pinged after each successful evaluation pass (so an
external service alerts on *missing* pings), and `GET /fleet/metrics` serves
Prometheus text behind `FLEET_METRICS_TOKEN` — its own read-only credential,
never an operator session.

## URLs

Page, filters, sort and tab all live in the URL
(`#/tills?state=offline`, `#/shops/<id>?tab=stock`). Links are shareable, the back button
works, and a refresh keeps you where you were.

## Design

`src/styles.css` holds the whole token system and is the place to start before
changing anything visual. Two rules the rest of the UI depends on:

- **Chroma is reserved for state.** There is no brand accent — primary buttons
  are ink (near-black in light, near-white in dark) so that green, amber and
  red only ever mean healthy, attention and offline. The single non-status hue
  is the focus ring. Sparklines inherit ink for the same reason: a trend is not
  a state.
- **Status is never colour alone.** Every state carries a shape (filled dot /
  ring) *and* a word, so the table is readable with red-green colour blindness.

Light and dark are both first-class and follow the OS until someone picks one
(`src/lib/theme.ts`).

## Code layout

- `src/api/` — the transport (`client.ts`: session, single-flight refresh,
  downloads), every endpoint (`endpoints.ts`) and the response types.
- `src/lib/query.ts` — the data layer: cached by key, one request per key,
  polling that pauses in a hidden tab, `invalidate(prefix)` after a write.
- `src/data.ts` — the reads, with their cache keys and poll rates.
- `src/pages/` — one file per page; shop and till sections live in
  `pages/shop/` and `pages/till/`.
- `src/lib/plain.ts` — the everyday wording for every health reason and
  alert rule. A new server reason needs a line here, or it reads "Needs a look".
