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
# two-line relay in front of an SMS/WhatsApp provider.
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

Sign in with your operator email and password. Optionally bake a default URL
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

The console can queue work for a terminal: **force sync**, **restart the local
server**, **collect logs**, **report now**. Delivery rides the existing
heartbeat — the terminal asks every ~3 minutes and the response carries whatever
is waiting — so there is no inbound port to a till behind a domestic router.

The command set is a fixed allowlist checked on **both** ends
(`server/src/services/fleet-commands.service.ts` and the switch in
`admin/electron/fleet-reporter.ts`). There is no shell, no path and no URL in any
payload: the worst a stolen operator session can do is ask a terminal to restart
its own backend, which is disruptive, immediately visible, and in the audit log
with a name against it. Commands expire, only one of each can be outstanding per
terminal, and a device on the shared enrollment key is never sent any — its
identity is asserted rather than proven.

## A shop's inventory

Open a shop's drawer and the last three sections are its stock, not its
machines: what the catalogue holds, a download of any of its books, and a way
to put inventory in on the shop's behalf. Onboarding a corner shop includes
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

A monitor cannot alert on its own death. Two outward-facing signals cover it:
`FLEET_HEARTBEAT_URL` is pinged after each successful evaluation pass (so an
external service alerts on *missing* pings), and `GET /fleet/metrics` serves
Prometheus text behind `FLEET_METRICS_TOKEN` — its own read-only credential,
never an operator session.

## URLs

View, filters, sort, page and the open drawer all live in the URL
(`#/terminals?state=offline&device=…`). Links are shareable, the back button
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
