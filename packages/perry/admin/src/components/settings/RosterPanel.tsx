// components/settings/RosterPanel — edit the team roster (identity mappings across
// Discord, Notion, Granola, GitHub). Edits are local until Save in the top bar.
import { CheckCircle2, Plus, Trash2, Users } from "lucide-react";
import type { ConfigState } from "../../hooks/useConfig";
import type { AppSettings } from "../../types";
import { Field, SectionTitle } from "../shared";

export function RosterPanel({ settings, config }: { settings: AppSettings; config: ConfigState }) {
  const { updatePerson } = config;
  return (
    <section className="panel roster-panel">
      <div className="panel-head">
        <SectionTitle icon={<Users size={19} />} title="Roster" />
        <button className="secondary" onClick={config.addPerson}>
          <Plus size={17} />
          <span>Add</span>
        </button>
      </div>
      <div className="roster">
        {settings.roster.map((person, index) => (
          <div className="roster-row" key={index}>
            <Field label="Name" value={person.name} onChange={(value) => updatePerson(index, "name", value)} />
            <Field label="Discord ID" value={person.discordUserId} onChange={(value) => updatePerson(index, "discordUserId", value)} />
            <Field label="Notion Name" value={person.notionName ?? ""} onChange={(value) => updatePerson(index, "notionName", value)} />
            <Field label="Granola Email" value={person.granolaEmail ?? ""} onChange={(value) => updatePerson(index, "granolaEmail", value)} />
            <Field label="GitHub" value={person.githubUsername ?? ""} onChange={(value) => updatePerson(index, "githubUsername", value)} />
            <Field label="Team" value={person.team ?? ""} onChange={(value) => updatePerson(index, "team", value)} />
            <label className="active-toggle">
              <CheckCircle2 size={17} />
              <input
                type="checkbox"
                checked={person.isActive !== false}
                onChange={(event) => updatePerson(index, "isActive", event.target.checked)}
              />
            </label>
            <button className="icon-button danger" aria-label={`Remove ${person.name || "person"}`} onClick={() => config.removePerson(index)}>
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
