# Panda Dashboard

A wall-tablet dashboard for the house, built on Home Assistant. The house is drawn as a
cross-section — roof panels, three floors of rooms, battery and grid on one side, heat pump
and the EV on the other — with live energy flowing between them. Rooms are tinted by how far
they sit from the 22° comfort target, so heating balance is visible at a glance.

![Home view](docs/home.png)

No build step, no framework, no dependencies: plain HTML, CSS and JavaScript talking to
Home Assistant over its WebSocket API.

## Views

| View | What's on it |
|---|---|
| **Home** | House cross-section with room temperature/humidity, motion, lights and AC; live solar, battery, grid, heat pump and EV flows; current tariff rate and when it changes; today's kWh and £; alerts (Sigen alarms, Axle VPP events, NAS, backups) |
| **Energy** | Power through the day with the off-peak window shaded; battery charge; 30 days of grid import/export and solar vs use; monthly import cost vs export credit; payback tracker with 25-year projection and a month-by-month table |
| **Climate** | Balance spread (target 1–1.5°), 24 h room temperatures against the 22° band, hot-water tank, AC mode controls |
| **Devices** | Every light and smart plug, Wake-on-LAN for a PC, TVs, washer, Synology NAS health, SigenStor hardware, HA backups |

## Run it

### Option 1 — Home Assistant add-on (recommended)

This repo is a Home Assistant add-on repository. Installed as an add-on, the dashboard gets its
own sidebar entry, sits behind your HA login, and updates from GitHub.

1. **Settings → Add-ons → Add-on Store → ⋮ → Repositories**, add
   `https://github.com/Suchabadpanda/Panda-Dashboard`. While the repo is private, add it as
   `https://<token>@github.com/Suchabadpanda/Panda-Dashboard` using a fine-grained token with
   read-only *Contents* access to this repo.
2. Close the dialog, refresh, and open **Panda Dashboard** in the store. Click **Install**
   (the first build takes a minute or two).
3. Turn on **Start on boot**, **Show in sidebar** and **Auto update**, then **Start**.
4. Open **Panda Dashboard** from the sidebar.

**Updates:** push to `main`. The *Release add-on* GitHub Action bumps the version in
`panda_dashboard/config.yaml` and adds a changelog line. HA picks it up on its next store check
(or **Add-on Store → ⋮ → Check for updates**) and installs it if Auto update is on. Put
`[release]` in a commit message to skip the bump.

**Tracker CSV:** copy `energy_monthly.csv` into the add-on's config folder,
`\\homeassistant.local\addon_configs\<id>_panda_dashboard\` over Samba.

### Option 1b — copy into /config/www

`deploy/deploy.ps1` (Samba) or `deploy/deploy.sh` (SSH) copies the app into `/config/www/panda-dashboard`;
open `http://homeassistant.local:8123/local/panda-dashboard/index.html`. No sidebar entry or
auto-update; useful for testing a change before pushing.

### Option 2 — on the NAS with Docker

```bash
cd deploy && docker compose up -d     # http://your-nas.local:8090
```

This is cross-origin, so open **Settings** (the status pill, top right) and enter the HA
address and a long-lived access token (HA → your profile → Security). The token stays in that
browser's local storage. Also allow the origin in `configuration.yaml`:

```yaml
http:
  cors_allowed_origins:
    - http://your-nas.local:8090
```

### Option 3 — demo

Open `panda_dashboard/www/index.html?demo`, or run `python3 tools/build_preview.py` for a single-file
`dist/preview.html`. Demo mode uses a snapshot of the real house taken on 18 Oct 2026
(states, today's power curves, 30 days of daily energy, monthly totals since April, 24 h of room
temperatures). Light toggles work locally in the demo.

### Kiosk tablet

Add `?kiosk` to keep the screen awake (Screen Wake Lock API, needs HTTPS or localhost on some
browsers). On an iPad, *Add to Home Screen* gives a full-screen app.

## Configure

The repo ships an **example** config, [`panda_dashboard/www/js/config.js`](panda_dashboard/www/js/config.js),
that matches the demo snapshot. Your own settings — rooms per floor, entity IDs, names, tariffs,
system cost — go in a separate `config.js` that never enters git:

| Running as | Put your `config.js` in |
|---|---|
| Add-on | `\\homeassistant.local\addon_configs\<id>_panda_dashboard\` |
| `/config/www` copy | `data\config.js` in your local clone (the deploy scripts copy it) |

Start from a copy of the example file and edit it. It loads after the example and replaces it,
so add-on updates never touch your settings. Reload the dashboard after changing it.

**Tariffs.** Rows apply from their `from` date; add a row when a rate changes. Keep
`tools/ha_energy_export.py → TARIFFS` in step if you use the exporter.

**Sign conventions** (Sigenergy integration): battery power is positive when charging, grid power
positive when importing.

## Money and payback

Carries on from the energy tracker, using its corrected savings formula:

```
baseline = what the household load would have cost with no system
actual   = import cost − export credit        (standing charge cancels)
saving   = baseline − actual
```

- **Import cost** is priced hour by hour from HA's hourly statistics against the time-of-use
  tariff, so it reflects how much import landed in the 00:00–06:00 window.
- **Baseline** is household load × `roi.baselineRate` (the pre-install average unit price) for
  months HA measured, otherwise the same calendar month before install from the tracker CSV.
- **Tracker months** use the CSV's import cost; export credit is accrued from export kWh at the
  export rate, since the CSV's credit column records lump payments that arrive months later.
- Months before HA started recording come from the tracker CSV; without
  it they are filled with the tracked monthly average and shown in italics as estimated.
  Partial months (install month, HA's first month, the current month) are left out of the average.
- The projection compounds the average monthly saving by `roi.priceRise` (5.5%/yr; try 8–10% for
  the elevated scenario).

### Bringing in the energy tracker history

Put the tracker's `energy_monthly.csv` in `data/` (git-ignored) before deploying, or use
**Energy → Payback → Import tracker CSV** in the browser. Columns:
`label,import_kwh,export_kwh,import_cost,export_credit,standing_charge`, plus optional `load_kwh`.

`tools/build_tracker_csv.py` builds the CSV from the E.ON billing workbook plus the Sigenergy
app's hourly export, which supplies import, export and house load for the months before HA:

```bash
python3 tools/build_tracker_csv.py --billing Energy_usage_2024-.xlsx --sigen sigen-hourly.xlsx --out data/energy_monthly.csv
```

The optional `load_kwh` column lets those months use the same load-based baseline as HA months.
For HA's first (partial) month, the CSV row covers only the days before HA started and is added to HA's figures.

`tools/ha_energy_export.py` is the updated exporter: it reads the SigenStor import/export
statistics and writes the same CSV with time-of-use pricing, for feeding the standalone tracker
or the Excel ROI sheet.

```bash
pip install websocket-client
HA_TOKEN=... python3 tools/ha_energy_export.py --out data/energy_monthly.csv
```

## Project layout

```
repository.yaml           marks the repo as an HA add-on repository
panda_dashboard/           the add-on: config.yaml, Dockerfile, nginx.conf, docs, icon
panda_dashboard/www/       the dashboard itself
  index.html              page shell + settings dialog
  css/app.css             all styles; light/dark tokens at the top
  js/config.js            rooms, entities, tariffs, ROI settings
  js/ha.js                WebSocket client, auth, state store
  js/data.js              history from long-term statistics, refreshed every 5 min
  js/tariff.js            time-of-use pricing, CSV parsing, ROI maths
  js/charts.js            small SVG line/bar charts with tooltips
  js/demo.js              demo snapshot of the real house
  js/views/*.js           Home, Energy, Climate, Devices
.github/workflows/        bumps the add-on version on each change
tools/                exporter script, preview bundler
deploy/               HA (bash/PowerShell) and NAS (Docker) deployment
data/                 your tracker CSV (ignored by git)
```

## Ideas for next

- Room-level heat-pump runtime vs outside temperature, to judge the radiator balancing
- Solar forecast (Solcast / Forecast.Solar) on the power chart
- Sigenergy EVAC charger and the 12 kW inverter's extra MPPTs once installed
- Octopus/EDF tariff comparison using the same hourly import data
