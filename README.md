# xray on Velixir (VLESS + WS + TLS)

TLS is terminated by the Velixir edge (`*.velixir.run` has HTTPS), so xray
itself serves plain VLESS over WebSocket on an internal port. A tiny Node
launcher proxies WebSocket upgrades from `$PORT` to xray and answers plain
HTTP (health probe) with `ok`.

## Required environment variables (set in the Velixir dashboard)

- `UUID` — VLESS client id
- `WSPATH` — WebSocket path, e.g. `/xxxxxxxx`

No credentials are stored in this repo. The xray binary is downloaded at
build time (`postinstall`) from the latest XTLS Xray-core release.
