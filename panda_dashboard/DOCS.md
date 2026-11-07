# Panda Dashboard

Opens from the **Panda Dashboard** entry in the sidebar. It signs in with your
Home Assistant session, so there is nothing to configure.

## Tariff

Set your electricity rates on the **Configuration** tab. Each row applies from its `from`
date until the next row; add a new row when rates change rather than editing the old one,
so earlier months keep the prices you actually paid. Rates are £ per kWh including VAT
(7.6p is `0.076`), the standing charge is £ per day, and the cheap window is in whole hours
(`off_peak_start: 0`, `off_peak_end: 6` means midnight to 06:00). Save, then reload the dashboard.

Optional `gas_rate` (£ per kWh including VAT) and `boiler_efficiency` (0.9 = 90%) turn on the
gas breakeven bar on Home's heat pump COP card. Both can also be set from the dashboard's
Settings, under the electricity tariff.

If the Energy Tracker add-on has recorded extra income for today (Axle events and the like), Home's
"Today so far" shows the net cost after that income (admins only — the tracker is found through
the Supervisor).

## Your settings

Copy `config.js` (your rooms, entities and tariffs) into this add-on's config folder:

- Samba: `\\homeassistant.local\app_configs\<id>_panda_dashboard\` (called `addon_configs`
  before Samba share 12.10; if the name doesn't resolve, use the IP address instead)
- SSH: `/addon_configs/<id>_panda_dashboard/`

Without it the dashboard uses the example settings, which match the demo snapshot.
Updates never overwrite files in this folder.

## Doorbell: recent rings

The front door card shows the last few rings when Home Assistant saves a picture on each one.
Add this automation (Settings → Automations → ⋮ → Edit in YAML). The card reads the
`doorbell` media folder unless `doorbell.snapshots` in config.js names another (false turns it off):

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


## AC: follow the room sensors

Each AC judges the temperature by its own sensor (often a degree or two off, and only whole degrees).
With two Home Assistant automations and a target helper per room, the AC's setpoint is moved so the
**room sensor** reaches the target. It only acts while an AC is on; it never turns one on or off.

In the dashboard config give each AC room its helper: `acTarget: 'input_number.office_ac_target'`.
The AC stepper on Rooms then sets the room target, and the card says what the unit itself is set to.
Without the helper (or before it exists) the stepper sets the unit's setpoint as before.

```yaml
# AC follows the room sensors — two automations, plus a change to "AC Quick Cool - On".
#
# First create these helpers (Settings → Devices & services → Helpers → Create helper):
#   Number  "Office AC target"          min 16, max 30, step 0.5, input field, unit °C  → input_number.office_ac_target
#   Number  "Living room AC target"     min 16, max 30, step 0.5, input field, unit °C  → input_number.living_room_ac_target
#   Number  "Rosalyn's room AC target"  min 16, max 30, step 0.5, input field, unit °C  → input_number.rosalyn_s_room_ac_target
#   Toggle  "AC follow room sensors"    (then switch it on)                              → input_boolean.ac_follow_room_sensors
# Set the targets to what you want each room to be (e.g. 22 / 22 / 21).
#
# Then: Settings → Automations → Create automation → ⋮ → Edit in YAML, paste one automation, save. Repeat.

# ── 1 ─────────────────────────────────────────────────────────────────────────
alias: AC - follow room sensors
description: >-
  While an AC is on (cool, heat or heat/cool), moves its own setpoint so the ROOM sensor
  reaches the room target (input_number). Setpoint = target + (AC's own reading − room
  sensor), ±1 while the room is more than 0.5 °C off target, rounded to the AC's 1 °C steps,
  kept within target ±3 and 18–30. Never turns an AC on or off. Runs every 5 min, when a
  target changes and 30 s after an AC starts. Switch off input_boolean.ac_follow_room_sensors
  to pause.
triggers:
  - trigger: time_pattern
    minutes: /5
  - trigger: state
    entity_id:
      - input_number.office_ac_target
      - input_number.living_room_ac_target
      - input_number.rosalyn_s_room_ac_target
  - trigger: state
    entity_id:
      - climate.office
      - climate.living_room
      - climate.rosalyn_s_room_ac
    to: [cool, heat, heat_cool]
    for:
      seconds: 30
  - trigger: state
    entity_id: input_boolean.ac_follow_room_sensors
    to: "on"
conditions:
  - condition: state
    entity_id: input_boolean.ac_follow_room_sensors
    state: "on"
variables:
  units:
    - ac: climate.office
      room: sensor.office_temp_humidity_temperature
      target: input_number.office_ac_target
    - ac: climate.living_room
      room: sensor.livingroomsensor_temperature
      target: input_number.living_room_ac_target
    - ac: climate.rosalyn_s_room_ac
      room: sensor.ewelink_snzb_02p_temperature
      target: input_number.rosalyn_s_room_ac_target
actions:
  - repeat:
      for_each: "{{ units }}"
      sequence:
        - variables:
            mode: "{{ states(repeat.item.ac) }}"
            room: "{{ states(repeat.item.room) | float(-99) }}"
            tgt: "{{ states(repeat.item.target) | float(-99) }}"
            acnow: "{{ state_attr(repeat.item.ac, 'current_temperature') | float(-99) }}"
            sp: "{{ state_attr(repeat.item.ac, 'temperature') | float(-99) }}"
            new_sp: >-
              {% if mode in ['cool', 'heat', 'heat_cool'] and room > -99 and tgt > -99 and sp > -99 %}
                {% set off = (acnow - room) if acnow > -99 else 0 %}
                {% set off = [[off, -3] | max, 3] | min %}
                {% set err = room - tgt %}
                {% set trim = -1 if err > 0.5 else (1 if err < -0.5 else 0) %}
                {% set want = (tgt + off + trim) | round(0) %}
                {% set want = [[want, tgt - 3] | max, tgt + 3] | min | round(0) %}
                {{ [[want, 18] | max, 30] | min | int }}
              {% else %}-1{% endif %}
        - if:
            - condition: template
              value_template: "{{ new_sp | int(-1) > 0 and (new_sp | float) != sp }}"
          then:
            - action: climate.set_temperature
              target:
                entity_id: "{{ repeat.item.ac }}"
              data:
                temperature: "{{ new_sp | int }}"
mode: queued
max: 3

# ── 2 ─────────────────────────────────────────────────────────────────────────
alias: AC - manual setpoint becomes room target
description: >-
  When a person changes an AC's setpoint (remote, airconwithme app, HA's own card) rather
  than an automation, that value becomes the room target, so "AC - follow room sensors"
  doesn't undo it.
triggers:
  - trigger: state
    entity_id:
      - climate.office
      - climate.living_room
      - climate.rosalyn_s_room_ac
    attribute: temperature
conditions:
  - condition: state
    entity_id: input_boolean.ac_follow_room_sensors
    state: "on"
  - condition: template
    value_template: >-
      {{ trigger.to_state.context.parent_id is none
         and trigger.to_state.state in ['cool', 'heat', 'heat_cool']
         and trigger.to_state.attributes.temperature is number }}
variables:
  targets:
    climate.office: input_number.office_ac_target
    climate.living_room: input_number.living_room_ac_target
    climate.rosalyn_s_room_ac: input_number.rosalyn_s_room_ac_target
actions:
  - action: input_number.set_value
    target:
      entity_id: "{{ targets[trigger.entity_id] }}"
    data:
      value: "{{ trigger.to_state.attributes.temperature }}"
mode: queued
max: 5

# ── 3: change to your existing "AC Quick Cool - On" ───────────────────────────
# Add this as the FIRST action, otherwise "follow room sensors" moves the ACs off 20 °C
# straight away (it would cool to the room targets instead):
#
#  - action: input_number.set_value
#    target:
#      entity_id:
#        - input_number.office_ac_target
#        - input_number.living_room_ac_target
#        - input_number.rosalyn_s_room_ac_target
#    data:
#      value: 20
```

## Room sleep mode

A **Sleep mode** button (moon icon) on a room's Home tile stops movement from switching that room's light on, so someone can sleep there. It's an `input_boolean` the room's motion-light automation checks; the dashboard only switches it.

1. Add the helper (Settings → Devices & services → Helpers → Toggle, or in `configuration.yaml`):

   ```yaml
   input_boolean:
     living_room_sleep_mode:
       name: Living room sleep mode
       icon: mdi:sleep
   ```

2. In the motion-light automation, add the helper to the condition of the step that turns the light **on** (leave the turn-off part alone, so a light switched on by hand still goes off once the room is empty):

   ```yaml
   - if:
     - condition: state
       entity_id: input_boolean.living_room_sleep_mode
       state: 'off'
     - condition: state
       entity_id: switch.living_room_light_switch
       state: 'off'
     # …the existing light-level condition
     then:
     - action: switch.turn_on
   ```

3. In `config.js`, on the room: `sleep: 'input_boolean.living_room_sleep_mode'` (or `sleep: { id, name }` for another label). A moon shows in the room's header while it's on. Until the helper exists the button is greyed out.

## Radiator valve: day/night schedule

A room's radiator valve dialog (tap the radiator chip) shows a **Schedule** when these helpers
exist. `<p>` is the climate id without `climate.` and `_thermostat`, so for
`climate.2f_bedroom_trv_thermostat` it is `2f_bedroom_trv`:

| Helper (Settings → Helpers) | Entity id |
|---|---|
| Toggle | `input_boolean.<p>_schedule` (on/off; optional) |
| Number, °C, step 0.5 | `input_number.<p>_day_target`, `input_number.<p>_night_target` |
| Date/time, time only | `input_datetime.<p>_day_start`, `input_datetime.<p>_night_start` |

The dashboard only changes the helpers; an automation sets the valve. It changes the target at the
two start times, again straight away when a helper changes, at start-up and when the valve comes
back online. A target changed by hand lasts until the next start time. Other ids can be named with
`trv: { climate, schedule: { on, day, night, dayStart, nightStart } }`, and `schedule: false` hides it.

```yaml
alias: Radiator valve day/night schedule (Panda Dashboard)
triggers:
  - trigger: time
    at: input_datetime.<p>_day_start
  - trigger: time
    at: input_datetime.<p>_night_start
  - trigger: state
    entity_id: [input_number.<p>_day_target, input_number.<p>_night_target,
                input_datetime.<p>_day_start, input_datetime.<p>_night_start]
  - trigger: state
    entity_id: input_boolean.<p>_schedule
    to: "on"
  - trigger: homeassistant
    event: start
  - trigger: state
    entity_id: climate.<p>_thermostat
    from: unavailable
variables:
  want: >-
    {% set ds = states('input_datetime.<p>_day_start') %}
    {% set ns = states('input_datetime.<p>_night_start') %}
    {% set t = now().strftime('%H:%M:%S') %}
    {% set day = (ds <= t < ns) if ds < ns else (t >= ds or t < ns) %}
    {{ states('input_number.<p>_day_target' if day else 'input_number.<p>_night_target') | float(0) }}
conditions:
  - condition: state
    entity_id: input_boolean.<p>_schedule
    state: "on"
  - "{{ want > 0 and states('climate.<p>_thermostat') not in ['unavailable', 'unknown']
       and state_attr('climate.<p>_thermostat', 'temperature') | float(0) != want }}"
actions:
  - action: climate.set_temperature
    target:
      entity_id: climate.<p>_thermostat
    data:
      temperature: "{{ want }}"
mode: queued
```

## Week page

Add a `week` block to config.js (see the example in `js/config.js`) and a **Week** page appears after Home. Remove the block to hide it.

**Calendars.** Events come from Home Assistant's `calendar.*` entities, read with `calendar.get_events` for the week shown. For Apple/iCloud calendars add the **CalDAV** integration (server `https://caldav.icloud.com`, your Apple ID and an app-specific password from appleid.apple.com). Google calendars use the **Google Calendar** integration. Every calendar is shown unless you list `calendars` or `hide` some. The same event on two calendars (same title and start) is shown once.

**Work start times.** Create one helper per workday so every screen shares the same start times (Settings → Devices & services → Helpers → Create helper → Date and/or time → *Time*):

```yaml
input_datetime:
  work_start_mon: { name: Work start Monday, has_date: false, has_time: true, initial: "08:00" }
  work_start_tue: { name: Work start Tuesday, has_date: false, has_time: true, initial: "08:00" }
  work_start_wed: { name: Work start Wednesday, has_date: false, has_time: true, initial: "08:00" }
  work_start_thu: { name: Work start Thursday, has_date: false, has_time: true, initial: "08:00" }
```

(If you create them in YAML, leave `initial` out once they exist, or a restart resets them.) Without the helpers, start times are saved on each screen. Optional `input_number.work_hours_<day>` overrides that day's hours.

**Ticking off a routine item.** Give a routine item `doneWhen: 'input_boolean.…'`; while it's on, the item is shown ticked for the current week. For example, an automation can turn it on when you've been in a zone for 20 minutes on Saturday or Sunday, and another turns it off at Monday 00:00:

```yaml
- alias: Week - visit done
  triggers: [{ trigger: zone, entity_id: person.you, zone: zone.visit, event: enter }]
  conditions: [{ condition: time, weekday: [sat, sun] }]
  actions:
    - wait_for_trigger: [{ trigger: zone, entity_id: person.you, zone: zone.visit, event: leave }]
      timeout: "00:20:00"
      continue_on_timeout: true
    - if: [{ condition: template, value_template: "{{ wait.trigger is none }}" }]
      then: [{ action: input_boolean.turn_on, target: { entity_id: input_boolean.visit_done } }]
- alias: Week - reset visit
  triggers: [{ trigger: time, at: "00:00:00" }]
  conditions: [{ condition: time, weekday: [mon] }]
  actions: [{ action: input_boolean.turn_off, target: { entity_id: input_boolean.visit_done } }]
```

View-only screens see everything but can't change start times.

