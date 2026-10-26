// wiki-schema — the Notion property names Perry writes, per wiki data source.
//
// The Notion databases must have properties with exactly these names; change a
// name here when a property is renamed in Notion. Wiki sync finds an existing
// page by one rich-text key property per kind (Source Decision ID, Source
// Action ID, the project's Graph Entity), so syncing a record again updates
// its page instead of creating another.
export const meetingNotesSchema = {
  title: "Title",
  source: "Source",
  sourceId: "Source ID",
  date: "Date",
  granolaLink: "Granola Link",
  attendees: "Attendees",
  project: "Project",
  discordMessage: "Discord Message",
  graphEntity: "Graph Entity",
} as const;

export const decisionSchema = {
  title: "Decision",
  meeting: "Meeting",
  project: "Project",
  status: "Status",
  owner: "Owner",
  evidence: "Evidence",
  graphFact: "Graph Fact",
  /** Lookup key: Perry's decision id. */
  sourceDecisionId: "Source Decision ID",
} as const;

export const actionItemSchema = {
  title: "Action",
  meeting: "Meeting",
  owner: "Owner",
  dueDate: "Due Date",
  status: "Status",
  project: "Project",
  /** Lookup key: Perry's action id. */
  sourceActionId: "Source Action ID",
  graphEntity: "Graph Entity",
} as const;

export const projectSchema = {
  title: "Project",
  owner: "Owner",
  status: "Status",
  discordChannel: "Discord Channel",
  repository: "Repository",
  /** Lookup key: the project's `project:<slug>` stable key. */
  graphEntity: "Graph Entity",
} as const;

/** All wiki schemas keyed by data source. */
export const notionWikiSchemas = {
  meetingNotes: meetingNotesSchema,
  decisions: decisionSchema,
  actionItems: actionItemSchema,
  projects: projectSchema,
} as const;
