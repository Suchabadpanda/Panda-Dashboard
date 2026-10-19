/*
 * Demo mode: a snapshot of a real Home Assistant instance (solar, SigenStor
 * battery, heat pump, EV) on 18 Oct 2026 at 23:20, with names made generic.
 * Used when the dashboard isn't connected, and for the offline preview. Daily, monthly and temperature history are
 * the real long-term statistics; today's power curves are keyframes traced
 * from the real 5-minute statistics.
 */
window.HD = window.HD || {};

(function () {
  const SNAP = Date.parse('2026-10-18T23:20:00+01:00');
  const DAY0 = Date.parse('2026-10-18T00:00:00+01:00');

  // [entity_id, state, unit, friendly_name, device_class]
  const S = [
    ['person.alex', 'home', '', 'Alex'],
    ['person.sam', 'home', '', 'Sam'],
    ['sensor.alex_phone_battery_level', '100', '%', 'Alex’s phone battery', 'battery'],
    ['sensor.sam_phone_battery_level', '100', '%', 'Sam’s phone battery', 'battery'],
    ['sun.sun', 'below_horizon', '', 'Sun'],
    ['sensor.sun_next_rising', '2026-10-19T06:34:51+00:00', '', 'Sun Next rising', 'timestamp'],
    ['sensor.sun_next_setting', '2026-10-19T17:04:06+00:00', '', 'Sun Next setting', 'timestamp'],
    // rooms
    ['sensor.ewelink_snzb_02p_temperature', '20.4', '°C', 'Bedroom 2 Temperature', 'temperature'],
    ['sensor.ewelink_snzb_02p_humidity', '59.0', '%', 'Bedroom 2 Humidity', 'humidity'],
    ['sensor.extra_temperature', '21.7', '°C', 'Upstairs Temperature', 'temperature'],
    ['sensor.extra_humidity', '54.7', '%', 'Upstairs Humidity', 'humidity'],
    ['sensor.1f_bedroom_temperature', '20.8', '°C', '1F Bedroom Temperature', 'temperature'],
    ['sensor.1f_bedroom_humidity', '62.7', '%', '1F Bedroom Humidity', 'humidity'],
    ['sensor.ewelink_snzb_02p_temperature_2', '22.3', '°C', 'Living room Temperature', 'temperature'],
    ['sensor.ewelink_snzb_02p_humidity_2', '52.0', '%', 'Living room Humidity', 'humidity'],
    ['sensor.office_temp_humidity_temperature', '22.7', '°C', 'Office Temperature', 'temperature'],
    ['sensor.office_temp_humidity_humidity', '50.8', '%', 'Office Humidity', 'humidity'],
    ['sensor.temp_humidity_kitchen_temperature', '22.0', '°C', 'Kitchen Temperature', 'temperature'],
    ['sensor.temp_humidity_kitchen_humidity', '55.6', '%', 'Kitchen Humidity', 'humidity'],
    ['climate.bedroom_2_ac', 'off', '', 'Bedroom 2 AC'],
    ['climate.living_room', 'off', '', 'Living room'],
    ['climate.office', 'off', '', 'Office'],
    ['switch.2f_landing', 'off', '', '2F Landing'],
    ['switch.living_room_light_switch', 'off', '', 'Living room Light'],
    ['switch.1f_landing', 'on', '', '1F Landing'],
    ['switch.office_light', 'on', '', 'Office Light'],
    ['switch.entrance_light', 'off', '', 'Entrance Light'],
    ['switch.ground_floor_toilet', 'off', '', 'Ground Floor Toilet'],
    ['switch.sonoff_s60zbtpg', 'on', '', 'Living Room TV Socket'],
    ['switch.sonoff_s60zbtpg_2', 'on', '', '2F Landing Socket'],
    ['switch.robot_vacuum_plug', 'on', '', 'Robot Vacuum Socket'],
    ['select.sonoff_10026839a2_1', 'on', '', 'Computer'],
    ['binary_sensor.2f_hallway_motion_sensor_occupancy', 'off', '', '2F Hallway Motion Sensor', 'motion'],
    ['binary_sensor.1f_motion_sensor_occupancy', 'off', '', '1F Motion Sensor', 'motion'],
    ['binary_sensor.office_motion_detector_occupancy', 'on', '', 'Office Motion Detector Occupancy', 'occupancy'],
    ['binary_sensor.downstair_corridor_motion_sensor_occupancy', 'off', '', 'Downstair Corridor Motion', 'motion'],
    ['sensor.sonoff_s60zbtpg_power', '0.0', 'W', 'Living Room TV Socket Power', 'power'],
    ['sensor.sonoff_s60zbtpg_power_2', '0.0', 'W', '2F Landing Socket Power', 'power'],
    ['sensor.robot_vacuum_plug_power', '0.0', 'W', 'Robot Vacuum Socket Power', 'power'],
    ['sensor.sonoff_s60zbtpg_summation_delivered', '18.02', 'kWh', 'Living Room TV Socket Summation delivered', 'energy'],
    ['sensor.robot_vacuum_plug_summation_delivered', '7.284', 'kWh', 'Robot Vacuum Socket Summation delivered', 'energy'],
    ['sensor.sonoff_10026839a2_power', '251.0', 'W', 'Computer Power', 'power'],
    ['sensor.sonoff_10026839a2_energy_day', '4.47', 'kWh', 'Computer Energy Day', 'energy'],
    ['sensor.sonoff_10026839a2_energy_month', '91.61', 'kWh', 'Computer Energy Month', 'energy'],
    // energy
    ['sensor.sigen_plant_pv_power', '0.0', 'kW', 'PV Power', 'power'],
    ['sensor.sigen_inverter_pv1_power', '0.0', 'kW', 'PV1 Power', 'power'],
    ['sensor.sigen_inverter_pv2_power', '0.0', 'kW', 'PV2 Power', 'power'],
    ['sensor.sigen_plant_consumed_power', '0.578', 'kW', 'Consumed Power', 'power'],
    ['sensor.sigen_plant_battery_power', '-4.526', 'kW', 'Battery Power', 'power'],
    ['sensor.sigen_plant_grid_active_power', '-3.693', 'kW', 'Grid Active Power', 'power'],
    ['sensor.sigen_plant_battery_state_of_charge', '8.4', '%', 'Battery State of Charge', 'battery'],
    ['sensor.sigen_plant_battery_state_of_health', '100.0', '%', 'Battery State of Health', 'battery'],
    ['sensor.sigen_plant_rated_energy_capacity', '27.12', 'kWh', 'Rated Energy Capacity', 'energy'],
    ['sensor.sigen_plant_ess_average_cell_temperature', '25.0', '°C', 'ESS Average Cell Temperature', 'temperature'],
    ['sensor.sigen_inverter_pcs_internal_temperature', '41.2', '°C', 'PCS Internal Temperature', 'temperature'],
    ['sensor.sigen_plant_ems_work_mode', 'AI Mode', '', 'EMS Work Mode'],
    ['sensor.sigen_plant_grid_connection_status', 'On Grid', '', 'Grid Connection Status'],
    ['sensor.sigen_plant_daily_pv_energy', '11.44', 'kWh', 'Daily PV Energy', 'energy'],
    ['sensor.sigen_plant_daily_load_consumption', '29.78', 'kWh', 'Daily Load Consumption', 'energy'],
    ['sensor.sigen_plant_daily_grid_import_energy', '39.66', 'kWh', 'Daily Grid Import Energy', 'energy'],
    ['sensor.sigen_plant_daily_grid_export_energy', '18.17', 'kWh', 'Daily Grid Export Energy', 'energy'],
    ['sensor.sigen_plant_daily_battery_charge_energy', '30.86', 'kWh', 'Daily Battery Charge Energy', 'energy'],
    ['sensor.sigen_plant_daily_battery_discharge_energy', '27.70', 'kWh', 'Daily Battery Discharge Energy', 'energy'],
    ['sensor.sigen_plant_pv_previous_day_generation', '11.54', 'kWh', 'PV Previous Day Generation', 'energy'],
    ['sensor.sigen_plant_total_imported_energy', '10475.78', 'kWh', 'Total Imported Energy', 'energy'],
    ['sensor.sigen_plant_total_exported_energy', '4632.71', 'kWh', 'Total Exported Energy', 'energy'],
    ['sensor.sigen_plant_total_pv_generation', '4492.69', 'kWh', 'Total PV Generation', 'energy'],
    ...Array.from({ length: 6 }, (_, i) => [`sensor.sigen_plant_general_alarm_${i + 1}`, 'No Problem', '', `General Alarm ${i + 1}`]),
    ...Array.from({ length: 5 }, (_, i) => [`sensor.sigen_inverter_alarm_${i + 1}`, 'No Problem', '', `Inverter Alarm ${i + 1}`]),
    // heat pump
    ['sensor.heat_pump_power_kw', '0.01', 'kW', 'Heat pump power (kW)', 'power'],
    ['sensor.heat_pump_energy_today', '11.279', 'kWh', 'Heat pump energy today', 'energy'],
    ['sensor.hot_water_tank_temperature', '19', '°C', 'Hot water tank temperature', 'temperature'],
    ['binary_sensor.legionella_cycle', 'off', '', 'Legionella cycle', 'heat'],
    ['water_heater.heat_pump', 'off', '', 'Heat pump'],
    ['climate.heat_pump_indoor1', 'off', '', 'Heat pump INDOOR1'],
    // EV
    ['sensor.tesla_wall_connector_status', 'not_connected', '', 'Tesla Wall Connector Status', 'enum'],
    ['binary_sensor.tesla_wall_connector_vehicle_connected', 'off', '', 'Vehicle connected', 'plug'],
    ['binary_sensor.tesla_wall_connector_contactor_closed', 'off', '', 'Contactor closed', 'battery_charging'],
    ['sensor.tesla_wall_connector_total_power', '0.0006', 'kW', 'Total power', 'power'],
    ['sensor.tesla_wall_connector_session_energy', '22.7144', 'kWh', 'Session energy', 'energy'],
    ['sensor.tesla_wall_connector_energy', '2333.361', 'kWh', 'Lifetime energy', 'energy'],
    ['sensor.espteslasolar_battery', 'unavailable', '%', 'ESPTeslaSolar Battery'],
    ['sensor.espteslasolar_range', 'unavailable', 'km', 'ESPTeslaSolar Range'],
    ['sensor.tesla_wall_connector_handle_temperature', '9.7', '°C', 'Handle temperature', 'temperature'],
    ['sensor.tesla_wall_connector_grid_voltage', '243.4', 'V', 'Grid voltage', 'voltage'],
    // doorbell (Eufy S220 + HomeBase)
    ['camera.doorbell', 'idle', '', 'Doorbell'],
    ['image.doorbell_event_image', 'unknown', '', 'Doorbell Event Image'],
    ['binary_sensor.doorbell_ringing', 'off', '', 'Doorbell Ringing'],
    ['binary_sensor.doorbell_motion_detected', 'off', '', 'Doorbell Motion', 'motion'],
    ['binary_sensor.doorbell_person_detected', 'off', '', 'Doorbell Person', 'occupancy'],
    ['sensor.doorbell_person_name', 'No Person', '', 'Doorbell Person Name'],
    ['sensor.doorbell_battery_percentage', '79', '%', 'Doorbell Battery', 'battery'],
    ['sensor.doorbell_charging_status', 'Not Charging', '', 'Doorbell Charging Status'],
    ['select.home_doorbell_guard_mode', 'Home', '', 'Guard Mode'],
    ['binary_sensor.home_doorbell_connected', 'on', '', 'HomeBase Connected'],
    // VPP
    ['sensor.axle_event_in_progress', 'off', '', 'Axle Event In Progress'],
    ['sensor.axle_event_later_today', 'off', '', 'Axle Event Later Today'],
    ['sensor.axle_event_tomorrow', 'off', '', 'Axle Event Tomorrow'],
    ['sensor.axle_start_time_friendly', 'unknown', '', 'Axle Start Time', 'timestamp'],
    ['sensor.axle_end_time_friendly', 'unknown', '', 'Axle End Time', 'timestamp'],
    ['sensor.axle_import_export', 'unknown', '', 'Axle Import / Export'],
    // devices
    ['media_player.office_tv', 'on', '', 'Office TV', 'tv'],
    ['media_player.living_room_tv', 'unavailable', '', 'Living room TV', 'tv'],
    ['sensor.washing_machine_machine_state', 'unavailable', '', 'Washing machine Machine state'],
    ['sensor.washing_machine_completion_time', 'unavailable', '', 'Washing machine Completion time'],
    ['button.wake_on_lan_pc', '2026-10-16T13:15:07+00:00', '', 'Wake on LAN PC'],
    ['input_boolean.ac_all_cool', 'off', '', 'AC Quick Cool'],
    ['sensor.nas_temperature', '61', '°C', 'NAS Temperature', 'temperature'],
    ['sensor.nas_cpu_utilisation_total', '3', '%', 'NAS CPU utilisation (total)'],
    ['sensor.nas_memory_usage_real', '42', '%', 'NAS Memory usage (real)'],
    ['sensor.nas_volume_1_status', 'normal', '', 'NAS (Volume 1) Status'],
    ['sensor.nas_volume_1_used_space', '0.486257', 'TB', 'NAS (Volume 1) Used space', 'data_size'],
    ['sensor.nas_volume_1_average_disk_temp', '47.0', '°C', 'NAS (Volume 1) Average disk temp', 'temperature'],
    ['binary_sensor.nas_security_status', 'off', '', 'NAS Security status', 'safety'],
    ['sensor.backup_last_successful_automatic_backup', '2026-10-18T03:04:08+00:00', '', 'Last successful automatic backup', 'timestamp'],
    ['sensor.backup_next_scheduled_automatic_backup', '2026-10-25T02:15:00+00:00', '', 'Next scheduled automatic backup', 'timestamp'],
  ];

  const WEATHER = { state: 'cloudy', attributes: { friendly_name: 'Forecast Home', temperature: 8.5, temperature_unit: '°C', humidity: 90, wind_speed: 12.05, wind_speed_unit: 'mph', cloud_coverage: 100, pressure: 1026.6 } };

  function buildStates() {
    const states = {};
    const ts = new Date(SNAP).toISOString();
    S.forEach(([id, state, unit, name, dc]) => {
      const attributes = { friendly_name: name };
      if (unit) attributes.unit_of_measurement = unit;
      if (dc) attributes.device_class = dc;
      states[id] = { entity_id: id, state, attributes, last_changed: ts, last_updated: ts };
    });
    states['weather.forecast_home'] = { entity_id: 'weather.forecast_home', ...WEATHER, last_changed: ts, last_updated: ts };
    return states;
  }

  // ── Today's 5-minute curves, traced from the real statistics ──
  // [hh:mm, value] keyframes, linearly interpolated.
  const K = {
    'sensor.sigen_plant_pv_power': [['0:00', 0], ['7:35', 0], ['7:50', .5], ['8:30', 1.06], ['9:00', 1.36], ['9:30', 1.77], ['10:00', 2.0], ['10:30', 2.15], ['11:00', 2.23], ['11:30', 2.2], ['11:45', 1.6], ['12:00', 2.32], ['12:30', 2.12], ['13:00', 1.95], ['13:30', 1.68], ['14:00', 1.6], ['14:30', 1.25], ['15:00', .75], ['15:30', .45], ['16:00', .75], ['16:30', .68], ['17:00', .25], ['17:15', .05], ['18:00', .05], ['18:45', 0], ['23:20', 0]],
    'sensor.sigen_plant_consumed_power': [['0:00', .7], ['0:15', 2.0], ['0:30', 1.2], ['1:00', .77], ['1:15', 2.7], ['1:40', 5.3], ['1:50', 6.3], ['2:10', 5.5], ['2:25', 3.4], ['3:00', 3.2], ['3:25', .5], ['3:40', 1.0], ['4:00', .3], ['4:45', .25], ['5:00', 1.1], ['5:45', 1.85], ['6:00', 1.3], ['6:10', .3], ['6:30', 1.7], ['6:55', .3], ['7:15', 1.4], ['7:30', .35], ['7:45', 1.6], ['8:15', 1.8], ['8:30', .35], ['8:45', .55], ['9:00', 1.6], ['9:15', 3.8], ['9:25', 5.3], ['9:35', 3.1], ['9:45', 1.0], ['10:00', .7], ['11:00', .6], ['11:30', .5], ['12:00', .3], ['12:30', .35], ['13:00', .6], ['13:30', .95], ['14:30', .85], ['15:00', .5], ['15:30', .3], ['16:00', .7], ['16:30', .5], ['16:50', 1.4], ['17:00', .6], ['17:30', 2.1], ['17:45', .5], ['18:15', 1.7], ['18:30', .5], ['19:00', .75], ['19:45', .7], ['20:00', 1.6], ['20:15', .6], ['20:40', 1.7], ['20:50', .65], ['21:15', 1.8], ['21:30', .55], ['22:00', .55], ['22:45', 1.6], ['23:00', .58], ['23:20', .58]],
    'sensor.sigen_plant_battery_power': [['0:00', 6.15], ['0:05', 6.33], ['4:20', 6.33], ['4:25', 1.23], ['4:30', 0], ['5:55', 0], ['6:00', -1.7], ['6:05', -.4], ['6:30', -1.6], ['6:45', -.4], ['7:00', -1.8], ['7:30', -1.3], ['7:45', -.4], ['8:30', -2.7], ['8:45', -3.9], ['9:00', -2.4], ['9:15', -.5], ['9:25', .6], ['10:00', 1.5], ['11:00', 1.4], ['11:30', 1.7], ['12:00', 2.0], ['12:30', 1.8], ['12:45', .8], ['13:00', 0], ['16:00', -.6], ['16:30', -.8], ['16:45', -1.4], ['17:00', -.6], ['17:30', -2.1], ['17:45', -.5], ['18:15', -1.7], ['18:30', -1.0], ['19:30', -.85], ['20:00', -2.2], ['20:15', -4.5], ['20:40', -5.7], ['20:50', -4.6], ['21:10', -5.8], ['21:25', -4.5], ['22:00', -4.5], ['22:15', -5.6], ['22:25', -4.5], ['23:20', -4.5]],
    'sensor.sigen_plant_grid_active_power': [['0:00', 7.2], ['1:15', 9.3], ['1:40', 12.9], ['2:00', 11.5], ['2:20', 9.9], ['3:00', 9.7], ['3:25', 7.0], ['4:00', 6.9], ['4:20', 6.9], ['4:25', 1.5], ['4:30', .3], ['4:45', 1.5], ['5:45', 1.9], ['6:00', 0], ['13:15', 0], ['13:20', -1.86], ['13:45', -1.5], ['14:00', -1.2], ['14:15', -.6], ['14:45', -.7], ['15:00', -.3], ['16:00', -.2], ['16:10', 0], ['20:00', 0], ['20:05', -1.41], ['20:15', -3.68], ['23:20', -3.68]],
    'sensor.sigen_plant_battery_state_of_charge': [['0:00', 1.0], ['0:30', 13.1], ['1:00', 25.0], ['2:00', 48.5], ['3:00', 71.7], ['4:00', 94.8], ['4:25', 100], ['6:00', 100], ['6:30', 97.6], ['7:00', 94.4], ['7:30', 92.8], ['8:00', 90.8], ['8:30', 89.0], ['9:00', 86.2], ['9:30', 88.4], ['10:00', 90.9], ['10:30', 94.0], ['11:00', 96.6], ['11:30', 99.8], ['12:00', 100], ['15:30', 100], ['16:00', 98.3], ['16:30', 97.1], ['17:00', 95.5], ['17:30', 93.7], ['18:00', 91.1], ['18:30', 89.5], ['19:00', 87.4], ['19:30', 80.6], ['20:00', 71.0], ['20:30', 60.5], ['21:00', 51.7], ['21:30', 42.3], ['22:00', 33.4], ['22:30', 24.8], ['23:00', 16.0], ['23:20', 10.1]],
    'sensor.heat_pump_power_kw': [['0:00', .01], ['1:40', .01], ['1:45', .6], ['1:50', 1.55], ['2:00', 4.73], ['3:05', 5.45], ['3:10', 4.4], ['3:15', .01], ['3:25', .9], ['3:40', .01], ['4:45', .2], ['4:50', 1.18], ['5:30', 1.38], ['5:40', .01], ['5:55', 1.44], ['6:10', .01], ['6:40', 1.29], ['6:50', .01], ['7:00', 1.3], ['7:20', 1.4], ['7:30', .01], ['7:50', 1.31], ['8:15', 1.4], ['8:25', .01], ['15:50', .01], ['16:00', .92], ['16:10', .01], ['16:20', 1.53], ['16:30', .01], ['16:40', .82], ['16:55', 1.19], ['17:05', .01], ['20:00', .02], ['20:10', 1.3], ['20:20', .01], ['23:20', .01]],
    'sensor.tesla_wall_connector_total_power': [['0:00', 0], ['23:20', 0]],
  };

  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  function interp(frames, min) {
    for (let i = 1; i < frames.length; i++) {
      const a = toMin(frames[i - 1][0]); const b = toMin(frames[i][0]);
      if (min <= b) { const t = b === a ? 1 : (min - a) / (b - a); return frames[i - 1][1] + t * (frames[i][1] - frames[i - 1][1]); }
    }
    return null;
  }
  function fiveMinute(id) {
    const fr = K[id]; if (!fr) return [];
    const out = [];
    for (let m = 0; m <= toMin('23:20'); m += 5) out.push({ start: DAY0 + m * 60000, end: DAY0 + (m + 5) * 60000, mean: +interp(fr, m).toFixed(3) });
    return out;
  }

  // ── Real daily kWh, 18 Sep → 18 Oct 2026 ──
  const D0 = Date.parse('2026-09-18T00:00:00+01:00');
  const DAILY = {
    'sensor.sigen_plant_total_load_consumption': [19.57, 21.3, 25.94, 20.87, 62.6, 29.43, 26.14, 20.83, 19.86, 44.75, 24.52, 22.09, 25.72, 23.19, 21.17, 19.51, 50.95, 21.18, 22.22, 26.12, 28.83, 22.6, 50.63, 28.77, 24.23, 20.25, 26.82, 22.62, 22.07, 50.96, 29.38],
    'sensor.sigen_plant_total_imported_energy': [30.27, 31.95, 32.66, 26.52, 65.15, 34, 31.88, 30.65, 26.89, 55.14, 31.15, 27.25, 31.4, 32.9, 31.03, 30.2, 57.39, 32.28, 31.47, 32.84, 35.62, 32.81, 58.87, 34.73, 32.87, 29.77, 31.39, 31.41, 33.48, 56.51, 39.66],
    'sensor.sigen_plant_total_exported_energy': [19.75, 17.91, 16.56, 21.58, 15.55, 15.15, 13.94, 15, 20.47, 16.91, 12.95, 15, 14.75, 19.46, 20.1, 17.92, 18.38, 16.89, 20.34, 8.92, 20.49, 14.51, 17.83, 13.92, 11.52, 16.86, 14.75, 12.94, 20.14, 16.35, 16.44],
    'sensor.sigen_plant_total_pv_generation': [11.11, 10.41, 14.86, 15.45, 15.8, 13.78, 11.73, 10.56, 15.39, 8.31, 11.02, 10.53, 10.92, 13.48, 14.29, 7.24, 10.89, 8.12, 11.2, 2.34, 14.63, 5.54, 11.46, 7.43, 3.18, 7.67, 11.17, 4.83, 9.57, 11.54, 11.45],
    'sensor.sigen_plant_total_charged_energy_of_the_ess': [26.54, 28.22, 27.64, 26.24, 28.87, 29.21, 28.57, 28.48, 25.6, 26.75, 27.08, 25.27, 28.59, 28.12, 26.89, 26.47, 28.01, 28.37, 27.06, 26.01, 29.02, 28.37, 28.78, 25.75, 26.13, 28.7, 30.48, 27.76, 30.95, 30.6, 30.86],
    'sensor.sigen_plant_total_discharged_energy_of_the_ess': [24.48, 25.05, 22.64, 26.73, 26.06, 26.02, 25.03, 23.1, 23.66, 24.95, 22.39, 24.57, 26.74, 24.39, 22.84, 26.45, 29.07, 26.03, 26.96, 25.87, 28.09, 27.13, 26.9, 26.29, 25.83, 28.36, 29.49, 27.08, 30.12, 29.86, 25.57],
    'sensor.heat_pump_energy': [1.57, 1.35, 6.56, .84, 2.64, .76, 4.46, 2.47, 3.1, 4.46, 5.03, 1.13, 3.36, 3.09, 2.46, 1.97, 5.9, 3.04, 3.4, 4.07, 7.36, 3.07, 7.6, 10.39, 6.17, 1.52, 3.67, 2.64, 3.81, 6.83, 11.96],
    'sensor.tesla_wall_connector_energy': [0, 0, 0, 0, 34.96, 0, 0, 0, 0, 24.91, 0, 0, 0, 0, 0, 0, 24.36, 0, 0, 0, 0, 0, 24.4, 0, 0, 0, 0, 0, 0, 22.71, 0],
  };

  // ── Real monthly kWh (HA statistics begin April 2026; Oct is month-to-date) ──
  const MONTHLY = {
    'sensor.sigen_plant_total_load_consumption': [['2026-04', 498.6], ['2026-05', 928.4], ['2026-06', 996.8], ['2026-07', 1137.1], ['2026-08', 1032.7], ['2026-09', 813.3], ['2026-10', 511.5]],
    'sensor.sigen_plant_total_imported_energy': [['2026-04', 696], ['2026-05', 1089.5], ['2026-06', 1075.5], ['2026-07', 1048.4], ['2026-08', 1107.3], ['2026-09', 1022.9], ['2026-10', 665.2]],
    'sensor.sigen_plant_total_exported_energy': [['2026-04', 583.9], ['2026-05', 644.6], ['2026-06', 552.4], ['2026-07', 730.9], ['2026-08', 609.5], ['2026-09', 500.5], ['2026-10', 297.8]],
    'sensor.sigen_plant_total_pv_generation': [['2026-04', 417.8], ['2026-05', 563.3], ['2026-06', 551.4], ['2026-07', 892.9], ['2026-08', 616.4], ['2026-09', 373.9], ['2026-10', 166]],
    'sensor.sigen_plant_total_charged_energy_of_the_ess': [['2026-04', 553.7], ['2026-05', 825.8], ['2026-06', 805.1], ['2026-07', 792.9], ['2026-08', 839.7], ['2026-09', 819.7], ['2026-10', 508.3]],
    'sensor.sigen_plant_total_discharged_energy_of_the_ess': [['2026-04', 522.5], ['2026-05', 746.1], ['2026-06', 727.4], ['2026-07', 719.5], ['2026-08', 758.2], ['2026-09', 736.7], ['2026-10', 486.3]],
    'sensor.heat_pump_energy': [['2026-05', 173.5], ['2026-06', 85.3], ['2026-07', 63.6], ['2026-08', 66.8], ['2026-09', 79.4], ['2026-10', 88.9]],
    'sensor.tesla_wall_connector_energy': [['2026-02', 176.7], ['2026-03', 116.7], ['2026-04', 147.2], ['2026-05', 105], ['2026-06', 142.5], ['2026-07', 167.4], ['2026-08', 146.2], ['2026-09', 115.9], ['2026-10', 71.5]],
  };

  // ── Real hourly room temperatures, last 24 h (00:00 → 22:00 local) ──
  const T0 = DAY0;
  const TEMPS = {
    'sensor.ewelink_snzb_02p_temperature': [20.5, 20.1, 19.9, 19.6, 19.6, 20, 20.4, 20.5, 20.6, 20.8, 20.8, 21, 21.1, 21.2, 21.1, 21, 21.2, 21.1, 21, 20.8, 21, 21.1, 20.8],
    'sensor.extra_temperature': [21.6, 21.5, 21.3, 21.2, 21, 21.3, 21.6, 21.7, 22, 22.2, 22.3, 22.1, 22, 22, 21.9, 21.9, 21.8, 21.6, 21.7, 21.7, 21.7, 21.8, 21.7],
    'sensor.1f_bedroom_temperature': [20.8, 20.6, 20.5, 20.3, 20.3, 21, 21.4, 21.6, 21.7, 21.7, 21.5, 21.4, 21.3, 21.1, 21, 21, 20.9, 20.9, 20.9, 20.9, 21.2, 21.3, 21],
    'sensor.ewelink_snzb_02p_temperature_2': [22.1, 21.9, 21.7, 21.6, 21.3, 21.7, 22.2, 22.3, 23.1, 24.5, 24.6, 24.3, 23.7, 23.8, 23.5, 22.9, 23, 23.5, 23.8, 23.5, 23.2, 23, 22.5],
    'sensor.office_temp_humidity_temperature': [22.9, 22.8, 22.9, 22.5, 21.5, 21.5, 21.7, 21.7, 21.9, 22.2, 22.5, 22.3, 22, 21.9, 22, 22.1, 22.3, 22.2, 22.4, 22.6, 22.8, 22.9, 22.9],
    'sensor.temp_humidity_kitchen_temperature': [21.6, 21.5, 21.1, 21, 21.1, 21.5, 22, 22.2, 23, 24.3, 24, 23.3, 23, 22.6, 22.4, 22.3, 22.1, 21.9, 22.2, 22.2, 22.3, 22.6, 22.3],
    'sensor.hot_water_tank_temperature': [35.5, 37, 55.7, 64.8, 64.7, 64.3, 63.8, 63.4, 62.7, 61.9, 58.4, 54.1, 51.1, 48.3, 46.4, 44.7, 43, 46.7, 46.3, 34.7, 28.5, 28.2, 26.4],
  };

  function monthStart(ym) { return Date.parse(`${ym}-01T00:00:00${['2026-11', '2026-12', '2026-01', '2026-02', '2026-03'].includes(ym) ? 'Z' : '+01:00'}`); }

  // Hourly grid import/export derived from today's grid curve (for today's cost)
  function hourlyGrid(sign) {
    const pts = fiveMinute('sensor.sigen_plant_grid_active_power');
    const out = [];
    for (let h = 0; h < 24; h++) {
      const seg = pts.filter((p) => p.start >= DAY0 + h * 3600e3 && p.start < DAY0 + (h + 1) * 3600e3);
      if (!seg.length) break;
      const kwh = seg.reduce((a, p) => a + Math.max(0, sign * p.mean) * (5 / 60), 0);
      out.push({ start: DAY0 + h * 3600e3, end: DAY0 + (h + 1) * 3600e3, change: +kwh.toFixed(3) });
    }
    return out;
  }

  function callWS(msg) {
    if (msg.type !== 'recorder/statistics_during_period') return Promise.resolve(null);
    const res = {};
    const start = Date.parse(msg.start_time);
    msg.statistic_ids.forEach((id) => {
      if (msg.period === '5minute') res[id] = fiveMinute(id);
      else if (msg.period === 'hour' && TEMPS[id]) res[id] = TEMPS[id].map((v, i) => ({ start: T0 + i * 3600e3, end: T0 + (i + 1) * 3600e3, mean: v }));
      else if (msg.period === 'hour' && id === HD.config.energy.totals.import) res[id] = start >= DAY0 - 3600e3 ? hourlyGrid(1) : null;
      else if (msg.period === 'hour' && id === HD.config.energy.totals.export) res[id] = start >= DAY0 - 3600e3 ? hourlyGrid(-1) : null;
      else if (msg.period === 'day' && DAILY[id]) res[id] = DAILY[id].map((v, i) => ({ start: D0 + i * 864e5, end: D0 + (i + 1) * 864e5, change: v }));
      else if (msg.period === 'month' && MONTHLY[id]) res[id] = MONTHLY[id].map(([ym, v]) => ({ start: monthStart(ym), change: v }));
      if (res[id] === null || res[id] === undefined) delete res[id];
    });
    return Promise.resolve(res);
  }

  HD.demo = {
    snapshotTime: SNAP,
    statsStart: Date.parse('2026-04-09T08:00:00+01:00'),   // first HA statistics row
    start() {
      HD.store.states = buildStates();
      HD.store.setStatus('demo', 'Demo · snapshot from 18 Oct 2026, 23:20');
    },
    callWS,
    callService(domain, service, data) {
      // Make toggles feel real in the demo
      const id = data && data.entity_id;
      const s = id && HD.store.states[id];
      if (s) {
        if (service === 'turn_on') s.state = 'on';
        else if (service === 'turn_off') s.state = 'off';
        else if (service === 'select_option') s.state = data.option;
        HD.store.emit(id);
      }
      return Promise.resolve();
    },
  };
})();
