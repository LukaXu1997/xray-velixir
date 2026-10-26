// Build-time helper: fetch the latest XTLS Xray-core linux-64 build and
// unpack the `xray` binary next to this script. Runs via `npm install`
// (postinstall), so the binary ends up in the deployed image and survives
// the platform's sleep/wake cycles. No credentials are involved.
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const https = require("node:https");

const API = "https://api.github.com/repos/XTLS/Xray-core/releases/latest";

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { "User-Agent": "xray-velixir", Accept: "application/vnd.github+json" } },
      (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(get(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`GET ${url} -> ${res.statusCode}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on("error", reject);
  });
}

(async () => {
  if (fs.existsSync("xray")) {
    console.log("xray binary already present, skipping download.");
    return;
  }
  const release = JSON.parse((await get(API)).toString("utf8"));
  const asset = (release.assets || []).find((a) => a.name === "Xray-linux-64.zip");
  if (!asset) throw new Error("Xray-linux-64.zip not found in latest release");
  console.log(`Downloading ${release.tag_name} (${asset.name})...`);
  const zip = await get(asset.browser_download_url);
  fs.writeFileSync("Xray-linux-64.zip", zip);
  execSync("unzip -o Xray-linux-64.zip xray", { stdio: "inherit" });
  fs.chmodSync("xray", 0o755);
  fs.unlinkSync("Xray-linux-64.zip");
  console.log("xray binary ready.");
})().catch((err) => {
  console.error("download-xray failed:", err.message);
  process.exit(1);
});
