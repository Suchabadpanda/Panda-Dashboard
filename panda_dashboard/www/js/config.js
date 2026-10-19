/*
 * Panda Dashboard — example configuration
 *
 * This file ships with the repo and matches the demo snapshot. Don't put your own
 * settings here: copy this file to config.js in the add-on's config folder
 * (\\homeassistant.local\addon_configs\<id>_panda_dashboard\) and edit that copy.
 * It loads after this one and replaces it, and updates never overwrite it.
 */
window.HD = window.HD || {};

HD.config = {
  title: 'Panda Dashboard',
  // Leave blank when the dashboard is served by Home Assistant itself
  // (/config/www/panda-dashboard → http://homeassistant.local:8123/local/panda-dashboard/).
  // Set it when you host the dashboard elsewhere (NAS / Docker) — see README.
  haUrl: '',

  // Target the heating is balanced around. Room tiles are tinted cooler/warmer than this.
  comfortTarget: 22,

  people: [
    { id: 'person.alex', name: 'Alex', phoneBattery: 'sensor.alex_phone_battery_level' },
    { id: 'person.sam', name: 'Sam', phoneBattery: 'sensor.sam_phone_battery_level' },
  ],

  weather: 'weather.forecast_home',
  sun: { state: 'sun.sun', rising: 'sensor.sun_next_rising', setting: 'sensor.sun_next_setting' },

  // ── The house, top floor first. Drawn as a cross-section on the Home view. ──
  floors: [
    {
      name: 'Second floor', short: '2F',
      rooms: [
        { name: 'Bedroom 2', temp: 'sensor.ewelink_snzb_02p_temperature', hum: 'sensor.ewelink_snzb_02p_humidity',
          climate: 'climate.bedroom_2_ac' },
        { name: 'Upstairs', temp: 'sensor.extra_temperature', hum: 'sensor.extra_humidity',
          light: 'switch.2f_landing', lightName: 'Landing', lightWhere: 'landing', motion: 'binary_sensor.2f_hallway_motion_sensor_occupancy',
          socket: 'switch.sonoff_s60zbtpg_2', socketName: 'Landing socket' },
      ],
    },
    {
      name: 'First floor', short: '1F',
      rooms: [
        { name: 'Bedroom 1', temp: 'sensor.1f_bedroom_temperature', hum: 'sensor.1f_bedroom_humidity' },
        { name: 'Living room', temp: 'sensor.ewelink_snzb_02p_temperature_2', hum: 'sensor.ewelink_snzb_02p_humidity_2',
          climate: 'climate.living_room', light: 'switch.living_room_light_switch', lightName: 'Main light',
          tv: 'media_player.living_room_tv',
          extraLights: [{ id: 'switch.1f_landing', name: 'Landing', where: 'landing' }],
          motion: 'binary_sensor.1f_motion_sensor_occupancy',
          socket: 'switch.sonoff_s60zbtpg', socketName: 'TV socket', socketPower: 'sensor.sonoff_s60zbtpg_power' },
      ],
    },
    {
      name: 'Ground floor', short: 'GF',
      rooms: [
        { name: 'Office', temp: 'sensor.office_temp_humidity_temperature', hum: 'sensor.office_temp_humidity_humidity',
          climate: 'climate.office', light: 'switch.office_light', lightName: 'Light',
          tv: 'media_player.office_tv',
          motion: 'binary_sensor.office_motion_detector_occupancy',
          plugPower: 'sensor.sonoff_10026839a2_power', plugName: 'Computer' },
        { name: 'Kitchen', temp: 'sensor.temp_humidity_kitchen_temperature', hum: 'sensor.temp_humidity_kitchen_humidity',
          thermostat: true,
          washer: 'sensor.washing_machine_machine_state', washerDone: 'sensor.washing_machine_completion_time',
          light: 'switch.entrance_light', lightName: 'Entrance', lightWhere: 'hallway',
          extraLights: [{ id: 'switch.ground_floor_toilet', name: 'Toilet' }],
          motion: 'binary_sensor.downstair_corridor_motion_sensor_occupancy' },
      ],
    },
  ],

  // ── Energy: SigenStor EC 6.0 SP (Sigenergy Modbus integration) ──
  // Sign conventions as reported by the integration:
  //   battery_power  + charging   − discharging
  //   grid_active    + importing  − exporting
  energy: {
    pvPower: 'sensor.sigen_plant_pv_power',
    pv1Power: 'sensor.sigen_inverter_pv1_power',          // roof strings
    pv2Power: 'sensor.sigen_inverter_pv2_power',          // ground mount (Tigo, MPPT 2)
    loadPower: 'sensor.sigen_plant_consumed_power',
    batteryPower: 'sensor.sigen_plant_battery_power',
    gridPower: 'sensor.sigen_plant_grid_active_power',
    soc: 'sensor.sigen_plant_battery_state_of_charge',
    soh: 'sensor.sigen_plant_battery_state_of_health',
    capacity: 'sensor.sigen_plant_rated_energy_capacity',
    cellTemp: 'sensor.sigen_plant_ess_average_cell_temperature',
    inverterTemp: 'sensor.sigen_inverter_pcs_internal_temperature',
    emsMode: 'sensor.sigen_plant_ems_work_mode',
    gridStatus: 'sensor.sigen_plant_grid_connection_status',
    // today counters (reset at midnight)
    pvToday: 'sensor.sigen_plant_daily_pv_energy',
    loadToday: 'sensor.sigen_plant_daily_load_consumption',
    importToday: 'sensor.sigen_plant_daily_grid_import_energy',
    exportToday: 'sensor.sigen_plant_daily_grid_export_energy',
    chargeToday: 'sensor.sigen_plant_daily_battery_charge_energy',
    dischargeToday: 'sensor.sigen_plant_daily_battery_discharge_energy',
    pvYesterday: 'sensor.sigen_plant_pv_previous_day_generation',
    // lifetime counters (long-term statistics, used for history + ROI)
    totals: {
      import: 'sensor.sigen_plant_total_imported_energy',
      export: 'sensor.sigen_plant_total_exported_energy',
      pv: 'sensor.sigen_plant_total_pv_generation',
      load: 'sensor.sigen_plant_total_load_consumption',
      charge: 'sensor.sigen_plant_total_charged_energy_of_the_ess',
      discharge: 'sensor.sigen_plant_total_discharged_energy_of_the_ess',
      heatPump: 'sensor.heat_pump_energy',
      ev: 'sensor.tesla_wall_connector_energy',
    },
    alarms: [
      'sensor.sigen_plant_general_alarm_1', 'sensor.sigen_plant_general_alarm_2', 'sensor.sigen_plant_general_alarm_3',
      'sensor.sigen_plant_general_alarm_4', 'sensor.sigen_plant_general_alarm_5', 'sensor.sigen_plant_general_alarm_6',
      'sensor.sigen_inverter_alarm_1', 'sensor.sigen_inverter_alarm_2', 'sensor.sigen_inverter_alarm_3',
      'sensor.sigen_inverter_alarm_4', 'sensor.sigen_inverter_alarm_5',
    ],
  },

  heatPump: {
    power: 'sensor.heat_pump_power_kw',
    energyToday: 'sensor.heat_pump_energy_today',
    tankTemp: 'sensor.hot_water_tank_temperature',
    legionella: 'binary_sensor.legionella_cycle',
    waterHeater: 'water_heater.heat_pump',
    climate: 'climate.heat_pump_indoor1',
  },

  ev: {
    name: 'EV',
    status: 'sensor.tesla_wall_connector_status',
    connected: 'binary_sensor.tesla_wall_connector_vehicle_connected',
    charging: 'binary_sensor.tesla_wall_connector_contactor_closed',
    power: 'sensor.tesla_wall_connector_total_power',
    session: 'sensor.tesla_wall_connector_session_energy',
    lifetime: 'sensor.tesla_wall_connector_energy',
    // ESPHome BLE bridge — currently unavailable in HA; shown when it comes back
    carSoc: 'sensor.espteslasolar_battery',
    carRange: 'sensor.espteslasolar_range',
    carCharging: 'sensor.espteslasolar_charging',
    chargeLimit: 'number.espteslasolar_charging_limit',
    doors: 'lock.espteslasolar_doors',
    outsideTemp: 'sensor.espteslasolar_outside_temperature',
    tpms: { fl: 'sensor.espteslasolar_tpms_front_left', fr: 'sensor.espteslasolar_tpms_front_right', rl: 'sensor.espteslasolar_tpms_rear_left', rr: 'sensor.espteslasolar_tpms_rear_right' },
    handleTemp: 'sensor.tesla_wall_connector_handle_temperature',
    voltage: 'sensor.tesla_wall_connector_grid_voltage',
    batteryKwh: 75,              // usable pack size, for "kWh to full" estimates
  },

  doorbell: {
    name: 'Front door',
    camera: 'camera.doorbell',
    image: 'image.doorbell_event_image',          // picture from the last ring or motion
    ringing: 'binary_sensor.doorbell_ringing',
    motion: 'binary_sensor.doorbell_motion_detected',
    person: 'binary_sensor.doorbell_person_detected',
    personName: 'sensor.doorbell_person_name',
    battery: 'sensor.doorbell_battery_percentage',
    charging: 'sensor.doorbell_charging_status',
    guardMode: 'select.home_doorbell_guard_mode',
    baseConnected: 'binary_sensor.home_doorbell_connected',
    lowBattery: 20,                               // % — show a warning below this
  },

  vpp: {
    inProgress: 'sensor.axle_event_in_progress',
    later: 'sensor.axle_event_later_today',
    tomorrow: 'sensor.axle_event_tomorrow',
    start: 'sensor.axle_start_time_friendly',
    end: 'sensor.axle_end_time_friendly',
    direction: 'sensor.axle_import_export',
  },

  devices: {
    plugs: [
      { name: 'Computer', switchSelect: 'select.sonoff_10026839a2_1', power: 'sensor.sonoff_10026839a2_power', today: 'sensor.sonoff_10026839a2_energy_day', month: 'sensor.sonoff_10026839a2_energy_month' },
      { name: 'Living room TV socket', switch: 'switch.sonoff_s60zbtpg', power: 'sensor.sonoff_s60zbtpg_power', total: 'sensor.sonoff_s60zbtpg_summation_delivered' },
      { name: 'Robot vacuum socket', switch: 'switch.robot_vacuum_plug', power: 'sensor.robot_vacuum_plug_power', total: 'sensor.robot_vacuum_plug_summation_delivered' },
      { name: '2F landing socket', switch: 'switch.sonoff_s60zbtpg_2', power: 'sensor.sonoff_s60zbtpg_power_2' },
    ],
    media: ['media_player.office_tv', 'media_player.living_room_tv'],
    washer: 'sensor.washing_machine_machine_state',
    vacuumPower: 'sensor.robot_vacuum_plug_power',
    washerDone: 'sensor.washing_machine_completion_time',
    pcWake: 'button.wake_on_lan_pc',
    pcName: 'PC',
    acQuickCool: 'input_boolean.ac_all_cool',
    backupLast: 'sensor.backup_last_successful_automatic_backup',
    backupNext: 'sensor.backup_next_scheduled_automatic_backup',
  },

  tariffName: '',          // e.g. 'Octopus Go' — shown on the Energy view
  // ── Tariffs. Add a row when a rate changes; rows apply from their date. ──
  tariffs: [
    { from: '2025-10-29', offPeak: 0.076, peak: 0.2666, offPeakStart: 0, offPeakEnd: 6, export: 0.165, standing: 0.60 },
    // Export fix ends Nov 2026; ~12p expected. Confirm the date and rate, then edit this row.
    { from: '2026-12-01', offPeak: 0.076, peak: 0.2666, offPeakStart: 0, offPeakEnd: 6, export: 0.12, standing: 0.60, provisional: true },
  ],

  // ── Return on investment (carried over from the energy tracker) ──
  roi: {
    systemCost: 25000,
    installDate: '2025-10-29',
    // What a kWh of household load would have cost with no solar/battery
    // (pre-install average unit price from the billing history).
    baselineRate: 0.23,
    priceRise: 0.055,          // ONS long-run average; 8–10% for the elevated scenario
    horizonYears: 25,
    // Monthly history from the energy tracker (label,import_kwh,export_kwh,import_cost,export_credit,standing_charge).
    // Either path is tried; the first that loads wins. It fills months before HA started recording.
    csvUrls: ['data/energy_monthly.csv', '/local/energy-export.csv'],
  },
};
