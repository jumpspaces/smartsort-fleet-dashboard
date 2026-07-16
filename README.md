# SmartSort Fleet Dashboard

JumpSpaces-internal monitor for deployed SmartSort POS terminals. A standalone
SPA that reads the cloud droplet's `/fleet/*` endpoints — it is **not** part of
the app shop owners run, and it never touches shop-user auth.

## How it fits together

Each installed desktop terminal runs a **fleet reporter** (`admin/electron/fleet-reporter.ts`)
that POSTs a heartbeat + buffered client errors to `POST /fleet/report` on the
shared cloud droplet every ~3 minutes. The server (`server/src/routes/fleet.ts`)
upserts one `device_report` row per install and dedupes errors into `error_event`.
This dashboard renders those two feeds.

```
desktop terminals ──POST /fleet/report──▶  cloud droplet (server/)
                                                │  device_report / error_event
this dashboard   ──GET /fleet/devices────▶─────┘
                 ──GET /fleet/errors─────▶
```

## Server setup (once)

On the droplet's server env (`server/.env`), set two secrets:

```
FLEET_REPORT_SECRET=<openssl rand -hex 24>   # baked into the desktop build too
FLEET_ADMIN_SECRET=<openssl rand -hex 24>    # the dashboard login password
```

Bake `FLEET_URL` (the droplet's public URL) and the **same** `FLEET_REPORT_SECRET`
into the desktop build when packaging:

```
FLEET_URL=https://cloud… FLEET_REPORT_SECRET=… npm --prefix admin run electron:package
```

## Run the dashboard

```
npm install
npm run dev        # http://localhost:5180
# or: npm run build && npm run preview
```

At the login screen enter the droplet URL and the `FLEET_ADMIN_SECRET`. Optionally
bake a default URL with `VITE_FLEET_API=https://cloud…` at build time.

## Auth model

- Devices authenticate to `/fleet/report` with `X-Fleet-Key: FLEET_REPORT_SECRET`.
- This dashboard exchanges `FLEET_ADMIN_SECRET` at `/fleet/login` for a bearer and
  sends it on every read. Two distinct secrets, so a leaked device key can't read
  the fleet. Neither is a shop JWT.
