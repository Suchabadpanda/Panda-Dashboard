# Panda Tray

A Windows tray companion for Panda Dashboard.

- **Left-click the tray icon** for the quick panel: the electricity rate now and when it changes, battery, solar, house and grid power, the heat pump, your room lights and the dashboard's **Shortcuts** (the same ones as on its Home page, with the same confirmations).
- **Open dashboard** shows Panda Dashboard in its own window (wide or compact), signed in with the same token.
- **Right-click** for the menu: dashboard, settings, start with Windows, reconnect, quit.

It reads Panda Dashboard's own `config.js` from the add-on, so entities, shortcuts and tariffs (including rates saved from the dashboard) are never set up twice.

## Install

1. Download `Panda-Tray-Setup-<version>.exe` from the [latest release](https://github.com/Suchabadpanda/Panda-Dashboard/releases/latest) and run it. It installs for your Windows user, no admin rights needed. It isn't code-signed, so SmartScreen warns the first time: **More info → Run anyway**.
2. In Home Assistant: your profile → **Security** → **Long-lived access tokens** → **Create token**. Copy it.
3. Panda Tray's settings open on first run: enter your Home Assistant address (e.g. `http://homeassistant.local:8123`), optionally an away address (e.g. your Tailscale `https://…ts.net` one), paste the token, **Save and connect**.

Updates download in the background and install when you quit or restart.

## Security

- The token is encrypted for your Windows account (DPAPI via Electron `safeStorage`) and only sent to the addresses you enter. Plain `http://` is only accepted for home-network addresses.
- The token needs an **admin** user, because the app asks Home Assistant's Supervisor for the dashboard's settings (as the dashboard itself does).
- If Home Assistant rejects the token the app stops trying, so it can't trigger Home Assistant's login ban.
- Shortcuts marked `confirm` in `config.js` need a second tap within 4 seconds.

## Build

```bash
cd tray
npm ci
npm test
npm run dist          # Windows installer in tray/dist (run on Windows)
```

Releases are built by GitHub Actions (`.github/workflows/tray.yml`): bump `version` in `package.json`, commit, push a tag `v<version>`.
