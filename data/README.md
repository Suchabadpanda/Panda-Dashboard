Personal files for the dashboard when it's copied into /config/www (git-ignored).

- `config.js` — your settings (rooms, entities, tariffs). Start from
  `panda_dashboard/www/js/config.js` and edit.

The deploy scripts copy it into `/config/www/panda-dashboard/data/`. For the add-on, put it in
its config folder instead: `\\homeassistant.local\app_configs\<id>_panda_dashboard\`.
