# Changelog

## 0.3.57
- Solar strings: lifetime generation per string and in total

## 0.3.56
- Home: drop the cheap-rate time from the summary line

## 0.3.56
- Home: drop the cheap-rate time from the summary line

## 0.3.55
- Charging totals: ev.chargedIn moves known month totals out of 'before records' into their year

## 0.3.55
- Charging totals: ev.chargedIn adds monthly totals from before Home Assistant recorded the charger to their own year

## 0.3.54
- Car: show pending software updates and add Install now

## 0.3.53
- Heat pump: count a sustained draw with the heating off as hot water

## 0.3.52
- Home: one-line summary with presence, temperatures, energy, cheap rate and today's forecast

## 0.3.51
- AC badge in each room's corner: blue cooling, red heating, spins while running

## 0.3.50
- Rooms: fuller AC controls — target temperature, fan speed, swing, preset, device extras

## 0.3.49
- Colour themes, Lock PC, HA storage; faster updates and a slimmer image

## 0.3.48
- Charging totals: price with the Energy Tracker's tariff history

## 0.3.47
- Vacuum cleaning settings, car charging totals, solar strings chart

## 0.3.46
- Doorbell: live view straight from go2rtc, reconnects when the doorbell drops; Last person removed

## 0.3.45
- Floor plan: every floor drawn the same height so the first and second floors fill their columns; text still the same size on all floors

## 0.3.44
- Home: battery tile shows the charge/discharge rate and kWh stored

## 0.3.43
- Home and Rooms: drop the "thermostat" note from the kitchen

## 0.3.42
- Steadier layout: fixed-width digits, reserved lines so live values never resize tiles, no pop on redraw; no line-end labels on charts; floor tags removed from Home

## 0.3.41
- Home: toilet light gets its own icon

## 0.3.40
- Home: lights, AC and TV as icon-only buttons on the room tiles

## 0.3.39
- Home: heat pump COP to two decimal places

## 0.3.38
- Home: washer and dishwasher status as full-width rows that wrap instead of being cut off

## 0.3.37
- Floor plan: temperature in narrow rooms such as the hall, shrunk to fit

## 0.3.36
- Floor plan: same scale and text sizes on every floor; temperatures centred in each room's main part

## 0.3.35
- Vacuum map: load each new picture in the background so the map stops blinking

## 0.3.34
- Dishwasher: pick the programme and extras on the Devices card, Auto by default

## 0.3.33
- Heat pump heating/hot water lamps, weather over the roof, house drawn below zero on Power today, car keeps its last known state; Panda Tray 1.1.0

## 0.3.32
- Home: landings and hallway in the middle column so rooms line up floor to floor

## 0.3.31
- Living room FP300, 1F landing and hallway rooms, area-based sensors, dishwasher

## 0.3.30
- Home: battery card without the electricity rate; doorbell last person includes rings

## 0.3.29
- New car drawing, more colour and motion, bottom page bar on phones

## 0.3.28
- Tank chart back, mirrored battery line, fuller Charge now? card

## 0.3.27
- Faster updates and a tidier dashboard

## 0.3.26
- Energy: drop the end-of-line labels on Power today (legend covers it)

## 0.3.25
- Home: COP moves to its own card under the front door

## 0.3.24
- Home: heat pump COP from the Energy Tracker add-on

## 0.3.23
- Heat pump: running/resting from a threshold, standby draw shown

## 0.3.22
- Home: Shortcuts replace people tile; tariffs saved on the dashboard stick

## 0.3.21
- Car view: Tesla Fleet + Bluetooth bridge, top-down car with tyres and controls

## 0.3.20
- Doorbell: newer picture, refresh button, quicker live view

## 0.3.19
- Plan: drop the presence outline so lit rooms match the temperature plan

## 0.3.18
- Vacuum: per-floor Dreame maps and the robot's real position on the plan

## 0.3.17
- Plan: keep room names inside the walls; stop highlighted rooms looking bigger

## 0.3.16
- Robot vacuum on the floor plan (Dreame Vacuum integration)

## 0.3.15
- Merge Plan into Climate as a new Rooms view

## 0.3.14
- Tidy header and room controls; fix plan AC positions

## 0.3.13
- Add a floor plan view

## 0.3.12
- Energy: drop payback and money panels; AC buttons in room tiles

## 0.3.11
- Doorbell live view: wait for the ~20 s start-up

## 0.3.10
- Doorbell: show the event picture, fall back from the camera picture

## 0.3.9
- Doorbell: start the Eufy P2P stream for live view; battery time left

## 0.3.8
- Edit the tariff on the dashboard; TVs and washer in their rooms; drop NAS

## 0.3.7
- Fix invisible doorbell overlay blocking the whole dashboard

## 0.3.6
- Add the Eufy doorbell

## 0.3.5
- Reddit-style features, editable tariff, motion and header fixes

## 0.3.4
- Fix add-on image: build from nginx, not the Supervisor's base image

## 0.3.3
- Use Sigenergy hourly data for the months before HA

## 0.3.2
- Count only post-install days in the install month

## 0.3.1
- Merge the energy tracker CSV correctly

## 0.3.0
- Renamed to Panda Dashboard (add-on slug `panda_dashboard`).

## 0.2.0
- Personal settings now load from `config.js` in the add-on's config folder; the repo ships an example config and a demo with generic names.

## 0.1.1
- Package the dashboard as a Home Assistant add-on

## 0.1.0
- First release as a Home Assistant add-on: Home, Energy, Climate and Devices views,
  live SigenStor energy flows, time-of-use costs and payback tracking.
