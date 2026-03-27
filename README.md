# @sbe/relay

Minimal local relay for SBE MVP.

It accepts local CS2 GSI JSON on:
- `POST /gsi`

Then forwards normalized payload to backend over WebSocket:
- connect to `{RELAY_BACKEND_URL}/ws/relay`
- first message auth: `{"type":"auth","token":"<relay session token>"}`
- local auth endpoint for web bootstrap: `POST /auth`
- local status endpoint: `GET /status`

On startup it can also ensure the local Counter-Strike GSI config file exists at the configured Steam `cfg` path and points to the local relay `uri`.

For install-friendly Windows usage:
- writable relay data defaults to `%LOCALAPPDATA%\\SBE Relay`
- player-count runtime settings and temp captures live under that data directory
- `.env` is resolved from `SBE_ENV_PATH` first, then from the app directory / current working directory
- bundled OCR templates are resolved from the app directory by default; no extra path setup is required
- set `PLAYER_COUNT_DEBUG_PERSIST_ARTIFACTS=true` to save the latest raw/processed ROI images into the player-count output directory for OCR debugging

## Local scripts

- `npm run dev`
- `npm run build:release:win`
- `npm run build:release:win:dev`
- `npm run build:installer:win`
- `npm run launcher:win`
- `npm run build`
- `npm run test`
- `npm run lint`
- `npm run typecheck`
- `npm run start`
- `npm run start:launcher`

`launcher:win` watches for `cs2.exe` / `csgo.exe` and starts the relay only while the game is running.

Windows packaging flow:
- `npm run build:release:win -w @sbe/relay` builds a self-contained release folder with `node.exe`, relay `dist`, OCR templates, `SBE Relay Launcher.cmd`, and a tray launcher (`SBE Relay Tray.ps1` + `SBE Relay Tray.vbs`)
- `npm run build:installer:win -w @sbe/relay` builds that release folder and then compiles `installer/SBERelay.iss` with Inno Setup 6
- production builds can embed a runtime env file by setting `SBE_RELAY_EMBED_ENV_PATH` or by placing `.env.production` in `apps/relay`
- production builds inject the relay secret with `RELAY_SHARED_TOKEN` and override backend URL with `SBE_RELAY_BACKEND_URL`
- the release builder strips `*.test.js` files from `dist` and writes `build-info.json` with version metadata
- for production the local GSI target stays `http://127.0.0.1:3001/gsi`; only `RELAY_BACKEND_URL` should point to `https://sbe.gg` or the chosen origin backend
- the tray launcher starts hidden, lives in the Windows notification area, and opens the live launcher log on double-click

## Environment

Use one of:
- `.env.example` for `https://sbe.gg`
- `.env.localhost.example` for local backend (`http://localhost:8080`)

For local end-to-end checks, `RELAY_BACKEND_URL` and web `VITE_API_URL` should point to the same backend origin.
`build:release:win:dev` automatically embeds `.env.localhost.example` into the produced `release/win/.env`.
