#!/usr/bin/env node
/**
 * Canonical bootstrap for the Company Brain monorepo. Creates local env/config
 * files from the checked-in examples so `pnpm dev` / `pnpm build` just work.
 * Idempotent — never overwrites an existing file. Run via `pnpm bootstrap`.
 */
import { copyFileSync, existsSync } from "node:fs";
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

console.log(`\n${created} local file(s) created.\n`);
console.log("Next:");
console.log("  1. Fill in secrets:  packages/perry/.env  and  inky/.env");
console.log("  2. Set org/repos:    inky/inky.config.json");
console.log("  3. pnpm build        # builds every package (@inky/core first)");
console.log("  4. pnpm dev          # run Perry   |   pnpm standup   # run Inky");
