# Panda Dashboard

Opens from the **Panda Dashboard** entry in the sidebar. It signs in with your
Home Assistant session, so there is nothing to configure.

## Tariff

Set your electricity rates on the **Configuration** tab. Each row applies from its `from`
date until the next row; add a new row when rates change rather than editing the old one,
so earlier months keep the prices you actually paid. Rates are £ per kWh including VAT
(7.6p is `0.076`), the standing charge is £ per day, and the cheap window is in whole hours
(`off_peak_start: 0`, `off_peak_end: 6` means midnight to 06:00). Save, then reload the dashboard.

## Your settings

Copy `config.js` (your rooms, entities, tariffs and system cost) into this add-on's config folder:

- Samba: `\\homeassistant.local\addon_configs\<id>_panda_dashboard\`
- SSH: `/addon_configs/<id>_panda_dashboard/`

Without it the dashboard uses the example settings, which match the demo snapshot.
Updates never overwrite files in this folder.

## Energy tracker history

Copy `energy_monthly.csv` (columns `label,import_kwh,export_kwh,import_cost,export_credit,standing_charge`)
into this add-on's config folder:

- Samba: `\\homeassistant.local\addon_configs\<id>_panda_dashboard\`
- SSH: `/addon_configs/<id>_panda_dashboard/`

Reload the dashboard. The Payback panel then uses real figures for Nov 2025 – Mar 2026.

## Wall tablet

Open Home Assistant on the tablet and pick **Panda Dashboard** in the sidebar.
Settings → ⋮ hides the rest of the sidebar if you want it to fill the screen.

## Updates

Each push to `main` on GitHub that changes the dashboard bumps the version.
Home Assistant shows the update under Settings → Add-ons; turn on
**Auto update** on the add-on's page to install them without asking.
