#!/usr/bin/env node
/* Builds the release archive: runtime files only, deflate entries, forward-slash paths,
   no zip64 and no data descriptors.

   Why not Compress-Archive / tar? PowerShell's Compress-Archive writes '\' separators
   (so agent/update.js's `tar -xf` unpacked files with the wrong names on Windows), and
   bsdtar's zip writer produces an archive .NET's ZipFile cannot open, which is what
   install-online.ps1 uses. This writes the plainest possible zip, which both accept.

   Usage: node tools/make-release-zip.cjs [out.zip]
*/
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const INCLUDE = ['CSXS', 'css', 'host', 'js', 'modules', 'agent', 'index.html'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'agent-downloads', 'agent-debug', 'vectorizer-profile']);
const SKIP_EXT = new Set(['.md', '.zip']);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}
function dosDateTime(d) {
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31),
    date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  };
}

function collect(rel, out) {
  const abs = path.join(ROOT, rel);
  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) {
      if (SKIP_DIRS.has(name)) continue;
      collect(path.posix.join(rel, name), out);
    }
    return;
  }
  if (SKIP_EXT.has(path.extname(rel).toLowerCase())) return;
  out.push({ name: rel, data: fs.readFileSync(abs), mtime: stat.mtime });
}

function build(outPath) {
  const entries = [];
  for (const item of INCLUDE) {
    if (!fs.existsSync(path.join(ROOT, item))) throw new Error('missing runtime file/folder: ' + item);
    collect(item, entries);
  }
  if (entries.length > 65534) throw new Error('too many entries for a non-zip64 archive');

  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const packed = zlib.deflateRawSync(entry.data, { level: 9 });
    const useDeflate = packed.length < entry.data.length;
    const body = useDeflate ? packed : entry.data;
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const stamp = dosDateTime(entry.mtime || new Date());
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(useDeflate ? 8 : 0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(useDeflate ? 8 : 0, 10);
    header.writeUInt16LE(stamp.time, 12);
    header.writeUInt16LE(stamp.date, 14);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(body.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(nameBuf.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(offset, 42);

    parts.push(local, nameBuf, body);
    central.push(header, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  fs.writeFileSync(outPath, Buffer.concat(parts.concat([centralBuf, end])));
  return entries.length;
}

function manifestVersion() {
  const text = fs.readFileSync(path.join(ROOT, 'CSXS', 'manifest.xml'), 'utf8');
  const m = text.match(/ExtensionBundleVersion="([^"]+)"/);
  if (!m) throw new Error('cannot read ExtensionBundleVersion from CSXS/manifest.xml');
  return m[1];
}

if (require.main === module) {
  try {
    const version = manifestVersion();
    const out = process.argv[2] || path.join(ROOT, 'mockup-studio-' + version + '.zip');
    const count = build(out);
    console.log('built ' + path.basename(out) + ' (' + count + ' files, version ' + version + ')');
  } catch (e) {
    console.error('zip build failed: ' + (e && e.message ? e.message : e));
    process.exit(1);
  }
}

module.exports = { build };
