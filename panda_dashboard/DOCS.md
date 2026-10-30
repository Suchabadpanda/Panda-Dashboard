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

Copy `config.js` (your rooms, entities and tariffs) into this add-on's config folder:

- Samba: `\\homeassistant.local\app_configs\<id>_panda_dashboard\` (called `addon_configs`
  before Samba share 12.10; if the name doesn't resolve, use the IP address instead)
- SSH: `/addon_configs/<id>_panda_dashboard/`

Without it the dashboard uses the example settings, which match the demo snapshot.
Updates never overwrite files in this folder.

## Doorbell: recent rings

The front door card shows the last few rings when Home Assistant saves a picture on each one.
Add this automation (Settings → Automations → ⋮ → Edit in YAML) and set
`doorbell.snapshots: 'doorbell'` in config.js:

```yaml
alias: Doorbell ring pictures (Panda Dashboard)
mode: queued
triggers:
  - trigger: state
    entity_id: binary_sensor.doorbell_ringing
    to: "on"
actions:
  # Eufy sends the ring's thumbnail a few seconds after the ring
  - wait_for_trigger:
      - trigger: state
        entity_id: image.doorbell_event_image
    timeout: "00:01:00"
  - delay: "00:00:02"
  - action: image.snapshot
    target:
      entity_id: image.doorbell_event_image
    data:
      filename: "/media/doorbell/ring_{{ now().strftime('%Y%m%d_%H%M%S') }}.jpg"
```

Pictures stay in `/media/doorbell` (Media → My media) until you delete them; each is small.

## Battery plan and grid carbon

On Energy, **Battery plan** works out how far the battery needs charging in the next cheap window
to carry the house through the peak hours after it, from the last 7 days' use (car charging left
out) and the weather entity's hourly cloud forecast. It's advice only; it doesn't change the
battery's settings. `energy.batteryReserve` (%) is what it keeps back (default 5).

**Grid carbon** needs `carbon: { postcode: 'PO15' }` (the first half of your postcode). It
fetches the regional forecast from the GB Carbon Intensity API (api.carbonintensity.org.uk);
only the postcode district is sent.

## Look

Settings (the status pill, top right) → **Theme** and **Colours**: light, dark or match the
device, a colour palette, and your own accent colour if you like. Each screen keeps its own.

## Wall tablet

Open Home Assistant on the tablet and pick **Panda Dashboard** in the sidebar.
Settings → ⋮ hides the rest of the sidebar if you want it to fill the screen.

## Updates

Each push to `main` on GitHub that changes the dashboard bumps the version.
Home Assistant shows the update under Settings → Add-ons; turn on
**Auto update** on the add-on's page to install them without asking.
