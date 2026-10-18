Personal files for this dashboard. Both are git-ignored.

- `config.js` — your settings (rooms, entities, tariffs, system cost). Start from
  `home_dashboard/www/js/config.js` and edit.
- `energy_monthly.csv` — the energy tracker's monthly history (same columns as the example).

The deploy scripts copy them into `/config/www/home-dashboard/data/`. For the add-on, put them
in its config folder instead: `\\homeassistant.local\addon_configs\<id>_home_dashboard\`.
You can also load the CSV in one browser with **Energy → Payback → Import tracker CSV**.
The example CSV rows are made-up numbers that show the format.
