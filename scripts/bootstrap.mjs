#!/usr/bin/env node
/**
 * Canonical bootstrap for the Company Brain monorepo. Creates local env/config
 * files from the checked-in examples so `pnpm dev` / `pnpm build` just work.
 * Idempotent — never overwrites an existing file. Run via `pnpm bootstrap`.
 *
 * Perry's admin API and Granola webhook refuse to run without their tokens, so
 * bootstrap fills ADMIN_API_TOKEN and GRANOLA_WEBHOOK_TOKEN with fresh random
 * secrets when they are blank in packages/perry/.env. Existing values are never
 * replaced, and the secrets are not printed.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** [exampleFile, localFile] — local is created from example if it doesn't exist. */
const files = [
  ["packages/perry/.env.example", "packages/perry/.env"],
  ["inky/.env.example", "inky/.env"],
  ["inky/inky.config.example.json", "inky/inky.config.json"],
];

let created = 0;
for (const [from, to] of files) {
  const src = join(root, from);
  const dst = join(root, to);
  if (!existsSync(src)) {
    console.log(`  skip    ${to}  (no ${from})`);
    continue;
  }
  if (existsSync(dst)) {
    console.log(`  keep    ${to}  (already exists)`);
    continue;
  }
  copyFileSync(src, dst);
  console.log(`  created ${to}`);
  created++;
}

const generated = fillBlankSecrets(join(root, "packages/perry/.env"), ["ADMIN_API_TOKEN", "GRANOLA_WEBHOOK_TOKEN"]);
for (const name of generated) console.log(`  secret  ${name} generated in packages/perry/.env`);

console.log(`\n${created} local file(s) created.\n`);
console.log("Next:");
console.log("  1. Fill in secrets:  packages/perry/.env  and  inky/.env");
console.log("     (paste ADMIN_API_TOKEN from packages/perry/.env into the admin UI's Connect screen)");
console.log("  2. Set org/repos:    inky/inky.config.json");
console.log("  3. pnpm build        # builds every package (@inky/core first)");
console.log("  4. pnpm dev          # run Perry   |   pnpm standup   # run Inky");

/** Sets each `NAME=` line that has no value to a random 32-byte hex secret; returns the names it filled. */
function fillBlankSecrets(envPath, names) {
  if (!existsSync(envPath)) return [];
  const filled = [];
  const lines = readFileSync(envPath, "utf8")
    .split(/\r?\n/u)
    .map((line) => {
      const name = names.find((candidate) => line.trim() === `${candidate}=`);
      if (!name) return line;
      filled.push(name);
      return `${name}=${randomBytes(32).toString("hex")}`;
    });
  if (filled.length > 0) writeFileSync(envPath, lines.join("\n"));
  return filled;
}
