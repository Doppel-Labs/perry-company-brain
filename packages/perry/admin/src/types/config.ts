// types/config — wire shapes for /api/config and /api/diagnostics.
export type GranolaMode = "manual" | "zapier-webhook" | "api-poll";

export interface PersonConfig {
  name: string;
  discordUserId: string;
  notionName?: string;
  notionUserId?: string;
  granolaEmail?: string;
  githubUsername?: string;
  team?: string;
  timezone?: string;
  isActive?: boolean;
}

export interface RoutingRuleConfig {
  id: string;
  name: string;
  project?: string;
  titleKeywords: string[];
  attendeeEmails: string[];
  granolaFolderName?: string;
  discordChannelId?: string;
  notionDataSourceId?: string;
  publishMode: "approval" | "auto" | "draft";
  isActive: boolean;
}

export interface AppSettings {
  discord: {
    clientId?: string;
    guildId?: string;
    standupChannelId?: string;
    meetingChannelId?: string;
    adminRoleIds: string[];
  };
  notion: {
    standupDataSourceId?: string;
    meetingNotesDataSourceId?: string;
    meetingNotesDatabaseUrl?: string;
  };
  standup: {
    enabled: boolean;
    standupTime: string;
    reminderTime: string;
    preStandupReminderTime: string;
    timezone: string;
    formUrl?: string;
  };
  granola: {
    mode: GranolaMode;
    folderName?: string;
    pollIntervalMinutes: number;
    defaultPublishMode: "approval" | "auto" | "draft";
  };
  roster: PersonConfig[];
  routingRules: RoutingRuleConfig[];
}

/** `secrets` maps each secret's name to whether it is set; values are never sent. */
export interface ConfigResponse {
  settings: AppSettings;
  secrets: Record<string, boolean>;
  graphMemory: {
    enabled: boolean;
    bridgeUrl?: string;
    groupId: string;
    timeoutMs: number;
  };
  configPath: string;
}

export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "ready" | "missing" | "warning";
  detail: string;
}

export interface Diagnostics {
  checks: DiagnosticCheck[];
  ready: boolean;
  configPath: string;
  meetingStorePath: string;
  processedMeetingCount: number;
}
