// Launcher: runs xray (VLESS over WebSocket) on an internal port and
// proxies WebSocket upgrades from the platform-assigned $PORT to it.
// TLS is terminated by the Velixir edge, so xray itself runs plain WS.
// Config comes only from environment variables: UUID, WSPATH, PORT.
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");

const PORT = parseInt(process.env.PORT || "8080", 10);
const XRAY_PORT = 10000;
const UUID = process.env.UUID;
const WSPATH = process.env.WSPATH;

if (!UUID || !WSPATH) {
  console.error("Missing required env vars: UUID and WSPATH must be set.");
  process.exit(1);
}

if (!fs.existsSync("xray")) {
  console.log("xray binary missing, downloading now...");
  execSync("node download-xray.js", { stdio: "inherit" });
}

const config = {
  log: { loglevel: "warning" },
  inbounds: [
    {
      listen: "127.0.0.1",
      port: XRAY_PORT,
      protocol: "vless",
      settings: { clients: [{ id: UUID }], decryption: "none" },
      streamSettings: {
        network: "ws",
        security: "none",
        wsSettings: { path: WSPATH },
      },
    },
  ],
  outbounds: [{ protocol: "freedom", tag: "direct" }],
};
fs.writeFileSync("config.json", JSON.stringify(config));

const xray = spawn("./xray", ["run", "-config", "config.json"], {
  stdio: "inherit",
});
xray.on("exit", (code) => {
  console.error(`xray exited with code ${code}`);
  process.exit(code === 0 ? 0 : 1);
});

const server = http.createServer((req, res) => {
  // Health probe / any plain HTTP request.
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});

server.on("upgrade", (req, socket, head) => {
  let path = req.url || "";
  const q = path.indexOf("?");
  if (q !== -1) path = path.slice(0, q);
  if (path !== WSPATH) {
    socket.destroy();
    return;
  }
  const upstream = net.connect(XRAY_PORT, "127.0.0.1", () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\r\n");
    upstream.write(
      `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n${headers}\r\n\r\n`
    );
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});

server.listen(PORT, () => {
  console.log(`listening on ${PORT}, proxying ${WSPATH} -> xray :${XRAY_PORT}`);
});
