// components/settings/SettingsGrid — Discord, Notion, Standup, and Granola settings
// forms. Edits are local until Save in the top bar.
import { CalendarClock, Database, MessageSquare, Webhook } from "lucide-react";
import type { UpdateSetting } from "../../hooks/useConfig";
import type { AppSettings, GranolaMode } from "../../types";
import { Field, SectionTitle } from "../shared";

interface SettingsProps {
  settings: AppSettings;
  update: UpdateSetting;
}

export function SettingsGrid(props: SettingsProps) {
  return (
    <div className="grid">
      <DiscordSettings {...props} />
      <NotionSettings {...props} />
      <StandupSettings {...props} />
      <GranolaSettings {...props} />
    </div>
  );
}

function DiscordSettings({ settings, update }: SettingsProps) {
  return (
    <section className="panel">
      <SectionTitle icon={<MessageSquare size={19} />} title="Discord" />
      <Field label="Client ID" value={settings.discord.clientId ?? ""} onChange={(value) => update("discord", "clientId", value)} />
      <Field label="Guild ID" value={settings.discord.guildId ?? ""} onChange={(value) => update("discord", "guildId", value)} />
      <Field
        label="Standup Channel ID"
        value={settings.discord.standupChannelId ?? ""}
        onChange={(value) => update("discord", "standupChannelId", value)}
      />
      <Field
        label="Meeting Channel ID"
        value={settings.discord.meetingChannelId ?? ""}
        onChange={(value) => update("discord", "meetingChannelId", value)}
      />
      <Field
        label="Admin Role IDs"
        value={settings.discord.adminRoleIds.join(", ")}
        onChange={(value) =>
          update(
            "discord",
            "adminRoleIds",
            value
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean)
          )
        }
      />
    </section>
  );
}

function NotionSettings({ settings, update }: SettingsProps) {
  return (
    <section className="panel">
      <SectionTitle icon={<Database size={19} />} title="Notion" />
      <Field
        label="Standup Data Source ID"
        value={settings.notion.standupDataSourceId ?? ""}
        onChange={(value) => update("notion", "standupDataSourceId", value)}
      />
      <Field
        label="Meeting Notes Data Source ID"
        value={settings.notion.meetingNotesDataSourceId ?? ""}
        onChange={(value) => update("notion", "meetingNotesDataSourceId", value)}
      />
      <Field
        label="Meeting Notes Database URL"
        value={settings.notion.meetingNotesDatabaseUrl ?? ""}
        onChange={(value) => update("notion", "meetingNotesDatabaseUrl", value)}
      />
    </section>
  );
}

function StandupSettings({ settings, update }: SettingsProps) {
  return (
    <section className="panel">
      <SectionTitle icon={<CalendarClock size={19} />} title="Standup" />
      <label className="switch-row">
        <span>Enabled</span>
        <input
          type="checkbox"
          checked={settings.standup.enabled}
          onChange={(event) => update("standup", "enabled", event.target.checked)}
        />
      </label>
      <div className="split">
        <Field label="Reminder" type="time" value={settings.standup.reminderTime} onChange={(value) => update("standup", "reminderTime", value)} />
        <Field
          label="Pre-standup"
          type="time"
          value={settings.standup.preStandupReminderTime}
          onChange={(value) => update("standup", "preStandupReminderTime", value)}
        />
      </div>
      <Field label="Standup Time" type="time" value={settings.standup.standupTime} onChange={(value) => update("standup", "standupTime", value)} />
      <Field label="Timezone" value={settings.standup.timezone} onChange={(value) => update("standup", "timezone", value)} />
      <Field label="Form URL" value={settings.standup.formUrl ?? ""} onChange={(value) => update("standup", "formUrl", value)} />
    </section>
  );
}

function GranolaSettings({ settings, update }: SettingsProps) {
  return (
    <section className="panel">
      <SectionTitle icon={<Webhook size={19} />} title="Granola" />
      <label className="field">
        <span>Mode</span>
        <select value={settings.granola.mode} onChange={(event) => update("granola", "mode", event.target.value as GranolaMode)}>
          <option value="manual">Manual</option>
          <option value="zapier-webhook">Zapier Webhook</option>
          <option value="api-poll">API Poll</option>
        </select>
      </label>
      <label className="field">
        <span>Default Publishing</span>
        <select
          value={settings.granola.defaultPublishMode}
          onChange={(event) =>
            update("granola", "defaultPublishMode", event.target.value as AppSettings["granola"]["defaultPublishMode"])
          }
        >
          <option value="approval">Approval</option>
          <option value="auto">Auto Post</option>
          <option value="draft">Draft Only</option>
        </select>
      </label>
      <Field label="Folder Name" value={settings.granola.folderName ?? ""} onChange={(value) => update("granola", "folderName", value)} />
      <Field
        label="Poll Interval"
        type="number"
        value={String(settings.granola.pollIntervalMinutes)}
        onChange={(value) => update("granola", "pollIntervalMinutes", Number(value))}
      />
    </section>
  );
}
