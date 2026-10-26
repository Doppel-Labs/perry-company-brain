// hooks/useConfig — the editable settings and the config metadata loaded with them.
// Every mutator here is local; nothing is written until `useAdminData.saveConfig`.
import { useMemo, useState } from "react";
import type { AppSettings, ConfigResponse, PersonConfig, RoutingRuleConfig } from "../types";

const emptyPerson: PersonConfig = {
  name: "",
  discordUserId: "",
  notionName: "",
  team: "",
  timezone: "",
  granolaEmail: "",
  githubUsername: "",
  notionUserId: "",
  isActive: true,
};

/** Type-safe setter for one field of one settings section, e.g. `update("standup", "enabled", true)`. */
export type UpdateSetting = <Section extends keyof AppSettings, Key extends keyof AppSettings[Section]>(
  section: Section,
  key: Key,
  value: AppSettings[Section][Key]
) => void;

/** `settings` stays null until the initial load succeeds; App shows ConnectScreen until then. */
export function useConfig() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [secrets, setSecrets] = useState<Record<string, boolean>>({});
  const [graphMemory, setGraphMemory] = useState<ConfigResponse["graphMemory"] | null>(null);
  const [configPath, setConfigPath] = useState("");

  const activeRosterCount = useMemo(
    () => settings?.roster.filter((person) => person.isActive !== false).length ?? 0,
    [settings]
  );

  const update: UpdateSetting = (section, key, value) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            [section]: {
              ...current[section],
              [key]: value,
            },
          }
        : current
    );
  };

  function updatePerson<Key extends keyof PersonConfig>(index: number, key: Key, value: PersonConfig[Key]) {
    setSettings((current) => {
      if (!current) return current;
      const roster = current.roster.map((person, personIndex) =>
        personIndex === index ? { ...person, [key]: value } : person
      );
      return { ...current, roster };
    });
  }

  function addPerson() {
    setSettings((current) => (current ? { ...current, roster: [...current.roster, emptyPerson] } : current));
  }

  function removePerson(index: number) {
    setSettings((current) =>
      current ? { ...current, roster: current.roster.filter((_, personIndex) => personIndex !== index) } : current
    );
  }

  function addRoutingRule() {
    const nextRule: RoutingRuleConfig = {
      id: `route-${Date.now()}`,
      name: "New route",
      project: "",
      titleKeywords: [],
      attendeeEmails: [],
      granolaFolderName: "",
      discordChannelId: "",
      notionDataSourceId: "",
      publishMode: "approval",
      isActive: true,
    };
    setSettings((current) =>
      current ? { ...current, routingRules: [...current.routingRules, nextRule] } : current
    );
  }

  function updateRoutingRule<Key extends keyof RoutingRuleConfig>(
    index: number,
    key: Key,
    value: RoutingRuleConfig[Key]
  ) {
    setSettings((current) => {
      if (!current) return current;
      const routingRules = current.routingRules.map((rule, ruleIndex) =>
        ruleIndex === index ? { ...rule, [key]: value } : rule
      );
      return { ...current, routingRules };
    });
  }

  function removeRoutingRule(index: number) {
    setSettings((current) =>
      current
        ? { ...current, routingRules: current.routingRules.filter((_, ruleIndex) => ruleIndex !== index) }
        : current
    );
  }

  return {
    settings,
    setSettings,
    secrets,
    setSecrets,
    graphMemory,
    setGraphMemory,
    configPath,
    setConfigPath,
    activeRosterCount,
    update,
    updatePerson,
    addPerson,
    removePerson,
    addRoutingRule,
    updateRoutingRule,
    removeRoutingRule,
  };
}

export type ConfigState = ReturnType<typeof useConfig>;
