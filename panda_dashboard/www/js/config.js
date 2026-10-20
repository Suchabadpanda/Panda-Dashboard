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
        { name: 'Upstairs', slim: true, temp: 'sensor.extra_temperature', hum: 'sensor.extra_humidity',
          light: 'switch.2f_landing', lightName: 'Landing', lightWhere: 'landing', motion: 'binary_sensor.2f_hallway_motion_sensor_occupancy',
          socket: 'switch.sonoff_s60zbtpg_2', socketName: 'Landing socket' },
        // A room can name a Home Assistant area instead of sensors: the first temperature and
        // humidity sensors in that area are used, so a new sensor only needs putting in the area.
        { name: 'Bedroom 3', area: ['Bedroom 3'] },
      ],
    },
    {
      name: 'First floor', short: '1F',
      rooms: [
        { name: 'Bedroom 1', temp: 'sensor.1f_bedroom_temperature', hum: 'sensor.1f_bedroom_humidity' },
        // lux: a light-level sensor, shown on the room tile
        { name: 'Living room', temp: 'sensor.livingroomsensor_temperature', hum: 'sensor.livingroomsensor_humidity',
          lux: 'sensor.livingroomsensor_illuminance',
          climate: 'climate.living_room', light: 'switch.living_room_light_switch', lightName: 'Main light',
          tv: 'media_player.living_room_tv',
          motion: 'binary_sensor.living_room_livingroomsensor_occupancy',
          socket: 'switch.sonoff_s60zbtpg', socketName: 'TV socket', socketPower: 'sensor.sonoff_s60zbtpg_power' },
        // slim: a narrower tile in the house drawing (landings, hallways)
        { name: '1F landing', slim: true, temp: 'sensor.ewelink_snzb_02p_temperature_2', hum: 'sensor.ewelink_snzb_02p_humidity_2',
          light: 'switch.1f_landing', lightName: 'Landing', lightWhere: 'landing', motion: 'binary_sensor.1f_motion_sensor_occupancy' },
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
          washer: 'sensor.washing_machine_machine_state', washerDone: 'sensor.washing_machine_completion_time' },
        { name: 'Hallway', slim: true, area: ['Hallway'],
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
    handleTemp: 'sensor.tesla_wall_connector_handle_temperature',
    voltage: 'sensor.tesla_wall_connector_grid_voltage',
    batteryKwh: 75,              // usable pack size, for "kWh to full" estimates
    tyreTarget: 42,              // recommended tyre pressure, psi (low warning 3 psi under)
    colour: '#5f7fa8',           // paint colour for the car drawing on the Car page (any CSS colour)
    // The car itself: each key uses the first source that has it available, so the
    // Bluetooth bridge wins when the car's on the driveway and Tesla Fleet covers the rest.
    car: {
      sources: [
      { name: 'Bluetooth',            // ESPHome Tesla BLE bridge on the driveway: local, free, only in range
        soc: 'sensor.espteslasolar_battery', range: 'sensor.espteslasolar_range', limit: 'number.espteslasolar_charging_limit',
        asleep: 'binary_sensor.espteslasolar_asleep', charging: 'sensor.espteslasolar_charging', chargerPower: 'sensor.espteslasolar_charger_power',
        cable: 'binary_sensor.espteslasolar_charger', locked: 'lock.espteslasolar_doors', sentry: 'switch.espteslasolar_sentry_mode',
        windows: 'cover.espteslasolar_windows', frunk: 'cover.espteslasolar_frunk', trunk: 'cover.espteslasolar_trunk',
        chargePort: 'cover.espteslasolar_charge_port_door', climate: 'climate.espteslasolar_climate', flash: 'button.espteslasolar_flash_lights',
        outsideTemp: 'sensor.espteslasolar_outside_temperature', odometer: 'sensor.espteslasolar_odometer',
        doorFl: 'binary_sensor.espteslasolar_door_driver_front', doorFr: 'binary_sensor.espteslasolar_door_passenger_front',
        doorRl: 'binary_sensor.espteslasolar_door_driver_rear', doorRr: 'binary_sensor.espteslasolar_door_passenger_rear',
        tpmsFl: 'sensor.espteslasolar_tpms_front_left', tpmsFr: 'sensor.espteslasolar_tpms_front_right',
        tpmsRl: 'sensor.espteslasolar_tpms_rear_left', tpmsRr: 'sensor.espteslasolar_tpms_rear_right' },
      { name: 'Tesla Fleet',          // cloud: anywhere, polled every 10 min while awake
        soc: 'sensor.model_y_battery_level', range: 'sensor.model_y_battery_range', limit: 'number.model_y_charge_limit',
        awake: 'binary_sensor.model_y_status', charging: 'sensor.model_y_charging', chargerPower: 'sensor.model_y_charger_power',
        cable: 'binary_sensor.model_y_charge_cable', locked: 'lock.model_y_lock', sentry: 'switch.model_y_sentry_mode',
        windows: 'cover.model_y_windows', frunk: 'cover.model_y_froot', trunk: 'cover.model_y_boot',
        chargePort: 'cover.model_y_charge_port_door', climate: 'climate.model_y_climate', flash: 'button.model_y_flash_lights',
        insideTemp: 'sensor.model_y_inside_temperature', outsideTemp: 'sensor.model_y_outside_temperature', odometer: 'sensor.model_y_odometer',
        location: 'device_tracker.model_y_location', update: 'update.model_y_update',
        doorFl: 'binary_sensor.model_y_front_driver_door', doorFr: 'binary_sensor.model_y_front_passenger_door',
        doorRl: 'binary_sensor.model_y_rear_driver_door', doorRr: 'binary_sensor.model_y_rear_passenger_door',
        tpmsFl: 'sensor.model_y_tyre_pressure_front_left', tpmsFr: 'sensor.model_y_tyre_pressure_front_right',
        tpmsRl: 'sensor.model_y_tyre_pressure_rear_left', tpmsRr: 'sensor.model_y_tyre_pressure_rear_right' },
      ],
    },
  },

  // ── Floor plan: one entry per floor, rooms as polygons in any units (the viewBox sets the scale).
  // kind: room | wet | store | stairs. `sensor` borrows temperature, humidity, AC and TV from the
  // room of that name above; `lights` toggle when the room is tapped; `occupancy` shows presence.
  floorplan: {
    floors: [
      {
        name: 'Ground floor', viewBox: '0 0 400 330',
        rooms: [
          { id: 'kitchen', name: 'Kitchen', sensor: 'Kitchen', points: '10,10 390,10 390,170 10,170' },
          { id: 'office', name: 'Office', sensor: 'Office', lights: ['switch.office_light'], occupancy: 'binary_sensor.office_motion_detector_occupancy', points: '10,170 230,170 230,310 10,310' },
          { id: 'hall', name: 'Hall', sensor: 'Hallway', lights: ['switch.entrance_light'], occupancy: 'binary_sensor.downstair_corridor_motion_sensor_occupancy', points: '230,170 310,170 310,310 230,310' },
          { id: 'wc', name: 'WC', kind: 'wet', lights: ['switch.ground_floor_toilet'], points: '310,170 390,170 390,310 310,310' },
        ],
        doorbell: { x: 270, y: 310, facing: 'down' },
      },
      {
        name: 'First floor', viewBox: '0 0 400 330',
        rooms: [
          { id: 'living', name: 'Living room', sensor: 'Living room', lights: ['switch.living_room_light_switch'], points: '10,10 390,10 390,160 10,160' },
          { id: 'landing', name: 'Landing', sensor: '1F landing', lights: ['switch.1f_landing'], occupancy: 'binary_sensor.1f_motion_sensor_occupancy', points: '270,160 390,160 390,220 270,220' },
          { id: 'bed1', name: 'Bedroom 1', sensor: 'Bedroom 1', points: '10,160 270,160 270,220 390,220 390,310 10,310' },
        ],
      },
      {
        name: 'Second floor', viewBox: '0 0 400 330',
        rooms: [
          { id: 'up', name: 'Upstairs', sensor: 'Upstairs', points: '10,10 390,10 390,140 10,140' },
          { id: 'bath', name: 'Bathroom', kind: 'wet', points: '10,140 230,140 230,200 10,200' },
          { id: 'landing2', name: 'Landing', lights: ['switch.2f_landing'], occupancy: 'binary_sensor.2f_hallway_motion_sensor_occupancy', points: '230,140 390,140 390,200 230,200' },
          { id: 'bed2', name: 'Bedroom 2', sensor: 'Bedroom 2', points: '10,200 390,200 390,310 10,310' },
        ],
      },
    ],
  },

  // Robot vacuum (Dreame Vacuum integration). Everything is optional: the vacuum and its
  // map camera are found automatically, each Dreame map is matched to a floor by name
  // ("1F" ↔ "First floor") and its rooms to plan rooms by name ("Hallway" ↔ "Hall").
  // Fill in `maps`/`rooms` where names don't line up. Set vacuum: false to hide it.
  vacuum: {
    // entity: 'vacuum.my_dreame',
    // map: 'camera.my_dreame_map',
    // maps: { 'Downstairs': 'Ground floor' },                 // Dreame map → plan floor
    // rooms: { 'Downstairs': { 'Room 1': 'office', Garden: null } },   // Dreame room → plan room id
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
    daysSinceCharge: 'sensor.doorbell_days_since_last_charging',
    streamService: 'eufy_security',               // integration that starts/stops the P2P stream
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


  // ── Shortcuts on the Home page ──
  // toggle: an entity to flip · press: a button entity · service + entities ('lights' = every room light)
  shortcuts: [
    { name: 'All lights off', icon: 'lightsoff', service: 'switch.turn_off', entities: 'lights', confirm: 'Turn off all lights?' },
    { name: 'All AC', icon: 'snow', toggle: 'input_boolean.ac_all_cool' },
    { name: 'Wake PC', icon: 'power', press: 'button.wake_on_lan_pc', confirm: 'Wake up the PC?' },
    { name: 'Mute PC', icon: 'mute', press: 'button.pc_mute' },
    { name: 'Shut down PC', icon: 'power', press: 'button.pc_shutdown', confirm: 'Shut down the PC?', danger: true },
  ],
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
    // Battery-powered sensors: listed on Devices, and flagged on Home under 15%
    sensorBatteries: ['sensor.livingroomsensor_battery', 'sensor.ewelink_snzb_02p_battery', 'sensor.office_temp_humidity_battery', 'sensor.1f_motion_sensor_battery'],
  },

  // Dishwasher via Home Connect (Bosch, Siemens, Neff). Remove this block if you don't have one.
  dishwasher: {
    name: 'Dishwasher', room: 'Kitchen',
    state: 'sensor.dishwasher_operation_state', door: 'sensor.dishwasher_door',
    progress: 'sensor.dishwasher_programme_progress', finish: 'sensor.dishwasher_programme_finish_time',
    active: 'select.dishwasher_active_programme', selected: 'select.dishwasher_selected_programme',
    remoteStart: 'binary_sensor.dishwasher_remote_start', stop: 'button.dishwasher_stop_programme',
    saltLow: 'sensor.dishwasher_salt_nearly_empty', rinseLow: 'sensor.dishwasher_rinse_aid_nearly_empty',
    program: 'dishcare_dishwasher_program_eco_50',   // used only if the machine doesn't offer Auto; pick on the Devices card
  },

  tariffName: '',          // e.g. 'Octopus Go' — shown on the Energy view
  // ── Tariffs. Add a row when a rate changes; rows apply from their date. ──
  tariffs: [
    { from: '2025-10-29', offPeak: 0.076, peak: 0.2666, offPeakStart: 0, offPeakEnd: 6, export: 0.165, standing: 0.60 },
    // Export fix ends Nov 2026; ~12p expected. Confirm the date and rate, then edit this row.
    { from: '2026-12-01', offPeak: 0.076, peak: 0.2666, offPeakStart: 0, offPeakEnd: 6, export: 0.12, standing: 0.60, provisional: true },
  ],
};
