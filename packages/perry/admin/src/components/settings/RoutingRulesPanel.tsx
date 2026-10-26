// components/settings/RoutingRulesPanel — edit the rules that route Granola notes to a
// project, Discord channel, and Notion source. Edits are local until Save.
import { CheckCircle2, Plus, Trash2, Webhook } from "lucide-react";
import type { ConfigState } from "../../hooks/useConfig";
import { csv } from "../../lib/format";
import type { AppSettings, RoutingRuleConfig } from "../../types";
import { Field, SectionTitle } from "../shared";

export function RoutingRulesPanel({ settings, config }: { settings: AppSettings; config: ConfigState }) {
  const { updateRoutingRule } = config;
  return (
    <section className="panel routing-panel">
      <div className="panel-head">
        <SectionTitle icon={<Webhook size={19} />} title="Routing Rules" />
        <button className="secondary" onClick={config.addRoutingRule}>
          <Plus size={17} />
          <span>Add</span>
        </button>
      </div>
      <div className="routing-list">
        {settings.routingRules.length === 0 ? (
          <div className="empty">Add rules to route Granola folders, keywords, or attendees to project channels.</div>
        ) : (
          settings.routingRules.map((rule, index) => (
            <div className="routing-row" key={rule.id}>
              <Field label="Name" value={rule.name} onChange={(value) => updateRoutingRule(index, "name", value)} />
              <Field label="Project" value={rule.project ?? ""} onChange={(value) => updateRoutingRule(index, "project", value)} />
              <Field
                label="Title Keywords"
                value={rule.titleKeywords.join(", ")}
                onChange={(value) => updateRoutingRule(index, "titleKeywords", csv(value))}
              />
              <Field
                label="Attendee Emails"
                value={rule.attendeeEmails.join(", ")}
                onChange={(value) => updateRoutingRule(index, "attendeeEmails", csv(value))}
              />
              <Field
                label="Granola Folder"
                value={rule.granolaFolderName ?? ""}
                onChange={(value) => updateRoutingRule(index, "granolaFolderName", value)}
              />
              <Field
                label="Discord Channel"
                value={rule.discordChannelId ?? ""}
                onChange={(value) => updateRoutingRule(index, "discordChannelId", value)}
              />
              <Field
                label="Notion Source"
                value={rule.notionDataSourceId ?? ""}
                onChange={(value) => updateRoutingRule(index, "notionDataSourceId", value)}
              />
              <label className="field">
                <span>Publishing</span>
                <select
                  value={rule.publishMode}
                  onChange={(event) =>
                    updateRoutingRule(index, "publishMode", event.target.value as RoutingRuleConfig["publishMode"])
                  }
                >
                  <option value="approval">Approval</option>
                  <option value="auto">Auto Post</option>
                  <option value="draft">Draft Only</option>
                </select>
              </label>
              <label className="active-toggle">
                <CheckCircle2 size={17} />
                <input
                  type="checkbox"
                  checked={rule.isActive !== false}
                  onChange={(event) => updateRoutingRule(index, "isActive", event.target.checked)}
                />
              </label>
              <button className="icon-button danger" aria-label={`Remove ${rule.name}`} onClick={() => config.removeRoutingRule(index)}>
                <Trash2 size={17} />
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
