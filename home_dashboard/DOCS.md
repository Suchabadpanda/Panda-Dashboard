# Home Dashboard

Opens from the **Home Dashboard** entry in the sidebar. It signs in with your
Home Assistant session, so there is nothing to configure.

## Your settings

Copy `config.js` (your rooms, entities, tariffs and system cost) into this add-on's config folder:

- Samba: `\\homeassistant.local\addon_configs\<id>_home_dashboard\`
- SSH: `/addon_configs/<id>_home_dashboard/`

Without it the dashboard uses the example settings, which match the demo snapshot.
Updates never overwrite files in this folder.

## Energy tracker history

Copy `energy_monthly.csv` (columns `label,import_kwh,export_kwh,import_cost,export_credit,standing_charge`)
into this add-on's config folder:

- Samba: `\\homeassistant.local\addon_configs\<id>_home_dashboard\`
- SSH: `/addon_configs/<id>_home_dashboard/`

Reload the dashboard. The Payback panel then uses real figures for Nov 2025 – Mar 2026.

## Wall tablet

Open Home Assistant on the tablet and pick **Home Dashboard** in the sidebar.
Settings → ⋮ hides the rest of the sidebar if you want it to fill the screen.

## Updates

Each push to `main` on GitHub that changes the dashboard bumps the version.
Home Assistant shows the update under Settings → Add-ons; turn on
**Auto update** on the add-on's page to install them without asking.
