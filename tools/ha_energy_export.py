#!/usr/bin/env python3
"""
ha_energy_export.py — monthly energy CSV from Home Assistant long-term statistics.

Writes the energy tracker's CSV format:
    label,import_kwh,export_kwh,import_cost,export_credit,standing_charge

Updated for the SigenStor sensors and priced hour-by-hour against a
time-of-use tariff (off-peak 00:00–06:00), so import cost reflects how much of the
grid import landed in the cheap window.

The Panda Dashboard reads HA statistics directly and doesn't need this script.
Use it to keep the standalone energy tracker / Excel ROI sheet fed, or to bake
months into data/energy_monthly.csv.

Usage
    pip install websocket-client
    export HA_TOKEN=...                       # long-lived access token
    python3 ha_energy_export.py               # writes OUT_FILE
    python3 ha_energy_export.py --list        # list statistic IDs
    python3 ha_energy_export.py --out data/energy_monthly.csv --start 2026-04-01

Schedule daily (HA SSH add-on cron, or Windows Task Scheduler):
    0 6 * * * HA_TOKEN=... /usr/bin/python3 /config/scripts/ha_energy_export.py
"""

import argparse
import csv
import datetime as dt
import json
import os
import sys
from collections import defaultdict
from zoneinfo import ZoneInfo

try:
    import websocket  # pip install websocket-client
except ImportError:
    sys.exit("Missing dependency. Run:  pip install websocket-client")

# ----------------------------- CONFIG ---------------------------------------
HA_URL = os.environ.get("HA_URL", "ws://homeassistant.local:8123/api/websocket")
TOKEN = os.environ.get("HA_TOKEN", "")
TZ = ZoneInfo("Europe/London")

IMPORT_ID = "sensor.sigen_plant_total_imported_energy"
EXPORT_ID = "sensor.sigen_plant_total_exported_energy"

# Rows apply from their date. Keep in step with js/config.js → tariffs.
TARIFFS = [
    {"from": "2025-10-29", "off_peak": 0.08, "peak": 0.2666, "off_start": 0, "off_end": 6, "export": 0.165, "standing": 0.60},
    {"from": "2026-12-01", "off_peak": 0.08, "peak": 0.2666, "off_start": 0, "off_end": 6, "export": 0.12, "standing": 0.60},  # provisional
]

OUT_FILE = "/config/www/energy-export.csv"   # served at /local/energy-export.csv
START = "2025-10-01"
# ----------------------------------------------------------------------------


def tariff_at(t: dt.datetime) -> dict:
    row = TARIFFS[0]
    for r in TARIFFS:
        if t.date() >= dt.date.fromisoformat(r["from"]):
            row = r
    return row


def is_off_peak(t: dt.datetime) -> bool:
    r = tariff_at(t)
    h = t.hour
    if r["off_start"] <= r["off_end"]:
        return r["off_start"] <= h < r["off_end"]
    return h >= r["off_start"] or h < r["off_end"]


class HA:
    def __init__(self, url: str, token: str):
        if not token:
            sys.exit("Set HA_TOKEN (a long-lived access token from your HA profile → Security).")
        self.ws = websocket.create_connection(url, timeout=60)
        self.mid = 0
        json.loads(self.ws.recv())  # auth_required
        self.ws.send(json.dumps({"type": "auth", "access_token": token}))
        if json.loads(self.ws.recv()).get("type") != "auth_ok":
            sys.exit("Authentication failed — check HA_TOKEN and HA_URL.")

    def call(self, payload: dict):
        self.mid += 1
        payload["id"] = self.mid
        self.ws.send(json.dumps(payload))
        while True:
            m = json.loads(self.ws.recv())
            if m.get("id") == self.mid and m.get("type") == "result":
                if not m.get("success"):
                    sys.exit("HA error: " + json.dumps(m.get("error")))
                return m["result"]


def to_local(v) -> dt.datetime:
    if isinstance(v, (int, float)):
        return dt.datetime.fromtimestamp(v / 1000, tz=dt.timezone.utc).astimezone(TZ)
    return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00")).astimezone(TZ)


def hourly(ha: HA, sid: str, start: str):
    res = ha.call({
        "type": "recorder/statistics_during_period",
        "start_time": dt.datetime.fromisoformat(start).replace(tzinfo=TZ).isoformat(),
        "statistic_ids": [sid], "period": "hour", "types": ["change", "sum"], "units": {"energy": "kWh"},
    })
    rows, prev = [], None
    for r in res.get(sid, []):
        ch = r.get("change")
        if ch is None and r.get("sum") is not None:   # older HA: derive from cumulative sum
            ch = 0 if prev is None else r["sum"] - prev
            prev = r["sum"]
        rows.append((to_local(r["start"]), max(0.0, ch or 0.0)))
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list statistic IDs and exit")
    ap.add_argument("--out", default=OUT_FILE)
    ap.add_argument("--start", default=START, help="YYYY-MM-DD")
    a = ap.parse_args()

    ha = HA(HA_URL, TOKEN)
    if a.list:
        for m in sorted(ha.call({"type": "recorder/list_statistic_ids", "statistic_type": "sum"}), key=lambda m: m["statistic_id"]):
            print(f'{m["statistic_id"]:<60} {m.get("statistics_unit_of_measurement") or ""}')
        return

    months = defaultdict(lambda: {"import_kwh": 0.0, "export_kwh": 0.0, "import_cost": 0.0, "export_credit": 0.0, "days": set()})
    for t, kwh in hourly(ha, IMPORT_ID, a.start):
        r = tariff_at(t)
        m = months[t.strftime("%Y-%m")]
        m["import_kwh"] += kwh
        m["import_cost"] += kwh * (r["off_peak"] if is_off_peak(t) else r["peak"])
        m["days"].add(t.date())
    for t, kwh in hourly(ha, EXPORT_ID, a.start):
        m = months[t.strftime("%Y-%m")]
        m["export_kwh"] += kwh
        m["export_credit"] += kwh * tariff_at(t)["export"]
        m["days"].add(t.date())

    rows = []
    for key in sorted(months):
        m = months[key]
        standing = sum(tariff_at(dt.datetime.combine(d, dt.time(12), TZ))["standing"] for d in m["days"])
        rows.append({
            "label": key,
            "import_kwh": round(m["import_kwh"], 2), "export_kwh": round(m["export_kwh"], 2),
            "import_cost": round(m["import_cost"], 2), "export_credit": round(m["export_credit"], 2),
            "standing_charge": round(standing, 2),
        })

    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["label", "import_kwh", "export_kwh", "import_cost", "export_credit", "standing_charge"])
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} months to {a.out}")


if __name__ == "__main__":
    main()
