// Build-time helper: fetch the latest XTLS Xray-core linux-64 build and
// unpack the `xray` binary next to this script. Runs via `npm install`
// (postinstall), so the binary ends up in the deployed image and survives
// the platform's sleep/wake cycles. No credentials are involved.
//
// Extraction is pure Node.js on purpose: the build image has no `unzip`
// binary, so the zip is parsed directly (central directory + raw deflate
// via node:zlib) instead of shelling out.
const fs = require("node:fs");
const https = require("node:https");
const zlib = require("node:zlib");

const API = "https://api.github.com/repos/XTLS/Xray-core/releases/latest";

// Extract one entry from a zip file without external tools. Uses the
// central directory (authoritative sizes), so data descriptors and
// streaming-produced zips are handled. Supports stored (0) and deflate (8).
function extractEntry(zipPath, entryName, outPath) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("zip: end of central directory not found");
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error("zip: bad central directory entry");
    }
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const mode = buf.readUInt32LE(off + 38) >>> 16;
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (name === entryName) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) {
        throw new Error("zip: bad local file header");
      }
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      const comp = buf.subarray(dataStart, dataStart + compSize);
      let data;
      if (method === 8) data = zlib.inflateRawSync(comp);
      else if (method === 0) data = Buffer.from(comp);
      else throw new Error(`zip: unsupported compression method ${method}`);
      fs.writeFileSync(outPath, data);
      fs.chmodSync(outPath, mode & 0o777 ? mode & 0o777 : 0o755);
      return;
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`zip: entry ${entryName} not found`);
}

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

async function main() {
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
  extractEntry("Xray-linux-64.zip", "xray", "xray");
  fs.unlinkSync("Xray-linux-64.zip");
  console.log("xray binary ready.");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("download-xray failed:", err.message);
    process.exit(1);
  });
}

module.exports = { extractEntry };
