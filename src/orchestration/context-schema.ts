/**
 * Context schema for OpenClaw business context management.
 * Defines types for customers, projects, meetings, decisions, and patterns.
 */

/**
 * A customer entity from Obsidian Customers/ folder.
 */
export interface Customer {
  id: string;
  name: string;
  notes: string;
  contact?: string;
  email?: string;
  configuration?: Record<string, unknown>;
  tags?: string[];
  sourceFile: string;
}

/**
 * A project entity.
 */
export interface Project {
  id: string;
  name: string;
  description: string;
  customer?: string; // Reference to Customer.id
  status: "active" | "paused" | "completed" | "cancelled";
  startDate?: Date;
  tags?: string[];
  sourceFile: string;
}

/**
 * A meeting record from Obsidian Meetings/ folder.
 */
export interface Meeting {
  id: string;
  date: Date;
  title: string;
  attendees: string[];
  notes: string;
  actionItems: string[];
  decisions?: string[]; // References to Decision.id
  projects?: string[]; // References to Project.id
  sourceFile: string;
}

/**
 * A technical decision record from Obsidian Decisions/ folder.
 */
export interface Decision {
  id: string;
  date: Date;
  title: string;
  context: string;
  decision: string;
  consequences: string[];
  alternatives?: string[];
  status: "proposed" | "accepted" | "deprecated" | "superseded";
  sourceFile: string;
}

/**
 * A pattern note - effective prompts or techniques.
 */
export interface Pattern {
  id: string;
  name: string;
  description: string;
  prompt: string;
  category: "coding" | "debugging" | "architecture" | "communication" | "other";
  effectiveness?: number; // 0-1 score, updated based on CI/review success
  usageCount?: number;
  updatedAt?: number;
  sourceFile: string;
}

/**
 * Full business context collection.
 */
export interface BusinessContext {
  customers: Customer[];
  projects: Project[];
  meetings: Meeting[];
  decisions: Decision[];
  patterns: Pattern[];
  lastSyncAt?: number;
}

/**
 * Obsidian configuration for syncing.
 */
export interface ObsidianConfig {
  vaultPath: string;
  contextFolders: string[];
  ignorePatterns?: string[];
  syncInterval?: number; // milliseconds
}

/**
 * A context search result with relevance score.
 */
export interface ContextSearchResult<T = Customer | Project | Meeting | Decision | Pattern> {
  item: T;
  score: number;
  matchReason: string;
}

/**
 * Context injection options for prompt building.
 */
export interface ContextInjectionOptions {
  maxCustomers?: number;
  maxProjects?: number;
  maxMeetings?: number;
  maxDecisions?: number;
  maxPatterns?: number;
  includeInactive?: boolean;
}

/**
 * Built prompt with context.
 */
export interface ContextualPrompt {
  systemPrompt: string;
  userPrompt: string;
  injectedContext: {
    customers: Customer[];
    projects: Project[];
    meetings: Meeting[];
    decisions: Decision[];
    patterns: Pattern[];
  };
}
