import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = join(__dirname, "..", "..", "dist", "index.html");

let html = readFileSync(indexPath, "utf-8");

html = html.replace(/\s+type="module"/g, " defer");
html = html.replace(/\s+crossorigin/g, "");

writeFileSync(indexPath, html, "utf-8");
console.log("stripped type=module and crossorigin from dist/index.html");