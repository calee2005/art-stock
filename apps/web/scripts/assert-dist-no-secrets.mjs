#!/usr/bin/env node
/**
 * Fail the Pages build if the static artifact contains credential *values*.
 * Field names such as secretAccessKey in the form UI are expected.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist", import.meta.url));
const forbidden = [
  /AWS_SECRET_ACCESS_KEY/,
  /AKIA[0-9A-Z]{16}/,
  /wJalrXUtnFEMI/,
  /LTAI[0-9A-Za-z]{12,}/,
  /-----BEGIN (RSA |OPENSSH )?PRIVATE KEY-----/,
];

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

const files = walk(dist);
if (files.length === 0) {
  console.error("Pages dist is empty");
  process.exit(1);
}

let failed = false;
for (const file of files) {
  if (!/\.(js|css|html|json|txt|map)$/i.test(file)) {
    continue;
  }
  const body = readFileSync(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(body)) {
      console.error(`secret-like pattern ${pattern} in ${file}`);
      failed = true;
    }
  }
}

if (failed) {
  process.exit(1);
}
console.log(`checked ${files.length} files in apps/web/dist; no credential values`);
