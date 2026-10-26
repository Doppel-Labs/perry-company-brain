import assert from "node:assert/strict";
import test from "node:test";
import { findMissingStandups, type StandupEntry } from "@notion";
import type { Person } from "@core";

test("an entry with a Discord id also counts for a roster member matched only by name", () => {
  const roster: Person[] = [
    { name: "Ada", discordUserId: "111", notionName: "Ada Lovelace" },
    // No usable Discord id on file: can only be matched by notionName.
    { name: "Ben", discordUserId: "", notionName: "Ben Okafor" },
    { name: "Cy", discordUserId: "333", notionName: "Cy Twombly" },
    { name: "Dee", discordUserId: "444", notionName: "Dee Dee", isActive: false },
  ];
  const entries: StandupEntry[] = [
    { personName: "Ada Lovelace", discordUserId: "111" },
    { personName: "ben okafor", discordUserId: "222" },
  ];

  assert.deepEqual(
    findMissingStandups(entries, roster).map((person) => person.name),
    ["Cy"]
  );
});

test("entries with only a Discord id or only a name still match", () => {
  const roster: Person[] = [
    { name: "Ada", discordUserId: "111", notionName: "Ada Lovelace" },
    { name: "Ben", discordUserId: "222", notionName: "Ben Okafor" },
  ];
  assert.deepEqual(findMissingStandups([{ discordUserId: "111" }, { personName: "BEN OKAFOR" }], roster), []);
});
