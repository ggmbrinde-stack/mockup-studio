/* Offline checks for the React panel that CEP actually loads (dist/).
   The workspace harness (../tools/verify-host.cjs) still inspects the native
   panel, which is no longer the MainPath, so it cannot catch a break in here.

   Run: npm run verify
*/
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const repoRoot = join(appRoot, "..");
const dist = join(repoRoot, "dist");
const failures = [];
const notes = [];

const read = (p) => readFileSync(p, "utf8");
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
};

/* 1. dist/ is the thing CEP opens: it must exist and every local asset it
      references must be there too. */
const distIndex = join(dist, "index.html");
if (!existsSync(distIndex)) {
  failures.push("dist/index.html is missing — CEP would open an empty panel");
} else {
  const html = read(distIndex);
  const refs = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map((m) => m[1]);
  if (!refs.length) failures.push("dist/index.html references no local script or stylesheet");
  for (const ref of refs) {
    if (!existsSync(join(dist, ref))) failures.push(`dist/index.html references missing ${ref}`);
  }
  if (/\stype="module"/.test(html)) failures.push('dist/index.html still has type="module" — CEP cannot load ES modules');
  notes.push(`dist/index.html: ${refs.length} local asset(s) present`);
}

/* 2. Panel source -> host contract: every VB.* call must exist in host/*.jsx.
      VB.core/bridge/queue/_loadErrors are page globals the hooks publish. */
const pageGlobals = new Set(["VB.core", "VB.bridge", "VB.queue", "VB._loadErrors", "VB.vectorizer"]);
const srcFiles = walk(join(appRoot, "src"));
const called = new Set();
for (const file of srcFiles) {
  for (const m of read(file).matchAll(/\bVB\.[A-Za-z_][A-Za-z0-9_]*/g)) called.add(m[0]);
}
const hostDir = join(repoRoot, "host");
const defined = new Set();
for (const file of readdirSync(hostDir).filter((f) => f.endsWith(".jsx"))) {
  for (const m of read(join(hostDir, file)).matchAll(/\bVB\.[A-Za-z_][A-Za-z0-9_]*[ \t]*=/g)) {
    defined.add(m[0].replace(/[ \t]*=$/, ""));
  }
}
const undefinedCalls = [...called].filter((name) => !pageGlobals.has(name) && !defined.has(name));
if (undefinedCalls.length) failures.push(`panel calls host functions that do not exist: ${undefinedCalls.join(", ")}`);
else notes.push(`host contract: ${called.size} VB.* call(s) resolved`);

/* 3. i18n: every t("key") must exist in both locales, and the key sets must match. */
const usedKeys = new Set();
for (const file of srcFiles.filter((f) => /\.tsx?$/.test(f))) {
  for (const m of read(file).matchAll(/\bt\("[A-Za-z0-9_]+"/g)) usedKeys.add(m[0].slice(3, -1));
}
const keysOf = (file) => {
  const body = read(join(appRoot, "src", "locales", file));
  return new Set([...body.matchAll(/^\s{2}([A-Za-z0-9_]+):/gm)].map((m) => m[1]));
};
const en = keysOf("en.ts");
const pt = keysOf("pt.ts");
const missingEn = [...usedKeys].filter((k) => !en.has(k));
if (missingEn.length) failures.push(`keys used by components but missing from en.ts: ${missingEn.join(", ")}`);
for (const k of en) if (!pt.has(k)) failures.push(`en.ts key missing from pt.ts: ${k}`);
for (const k of pt) if (!en.has(k)) failures.push(`pt.ts key missing from en.ts: ${k}`);
if (!missingEn.length) notes.push(`i18n: ${usedKeys.size} used key(s) defined in ${en.size} EN / ${pt.size} PT`);

/* 4. What's new: every entry must name locale keys that exist and tour targets
      that the React tree renders, otherwise the card silently points nowhere. */
const whatsNewPath = join(repoRoot, "js", "whats-new.js");
if (existsSync(whatsNewPath)) {
  const text = read(whatsNewPath);
  /* Start at the assignment, not at the first "=" in the header comment. */
  const assignAt = text.indexOf("window.VBWHATSNEW");
  /* The file is a JS object literal (bare keys), so quote the keys before parsing
     instead of evaluating it. */
  const json = text
    .slice(text.indexOf("=", assignAt) + 1)
    .trim()
    .replace(/;$/, "")
    .replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)(\s*:)/g, '$1"$2"$3');
  let data = null;
  try { data = JSON.parse(json); } catch { failures.push("js/whats-new.js is not valid JSON after the assignment"); }
  if (data) {
    const ids = new Set();
    for (const file of srcFiles.filter((f) => /\.tsx$/.test(f))) {
      for (const m of read(file).matchAll(/id="([A-Za-z0-9_]+)"/g)) ids.add(m[1]);
    }
    for (const [version, entry] of Object.entries(data)) {
      for (const key of entry.bullets || []) if (!en.has(key)) failures.push(`what's new ${version}: bullet key ${key} missing from locales`);
      for (const step of entry.tour || []) {
        if (!ids.has(step.target)) failures.push(`what's new ${version}: tour target #${step.target} is not rendered by the panel`);
        for (const key of [step.titleKey, step.bodyKey]) if (!en.has(key)) failures.push(`what's new ${version}: ${key} missing from locales`);
      }
      notes.push(`what's new ${version}: ${(entry.bullets || []).length} bullet(s), ${(entry.tour || []).length} tour step(s)`);
    }
  }
} else {
  failures.push("js/whats-new.js is missing");
}

for (const line of notes) console.log("  ok   " + line);
for (const line of failures) console.log("  FAIL " + line);
if (failures.length) {
  console.log(`\n${failures.length} problem(s) in the React panel.`);
  process.exit(1);
}
console.log("\nPanel checks passed.");
