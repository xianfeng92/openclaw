/**
 * OpenClaw Agent Orchestration System
 *
 * A comprehensive system for managing AI agents with context awareness,
 * automatic retry, code review, and business context integration.
 */

// Core types
export * from "./types.js";

// Agent selection
export {
  categorizeTask,
  selectAgent,
  resolveAgent,
  resolveAgentWithContext,
  getRelevantContext,
  getAgentName,
  getAgentIcon,
  type TaskCategory,
} from "./agent-selector.js";

// Task registry
export {
  load,
  save,
  createTask,
  getTask,
  listTasks,
  updateTask,
  updateTaskStatus,
  deleteTask,
  clearCacheForTest,
} from "./task-registry.js";

// Git worktree management
export {
  createWorktree,
  removeWorktree,
  listWorktrees,
  getWorktreeBranch,
} from "./git-worktree.js";

// Tmux management
export {
  isTmuxAvailable,
  isSessionAlive,
  createSession,
  sendKeys,
  killSession,
  captureOutput,
  listSessions,
  getAttachCommand,
  detachSession,
  type TmuxSessionOptions,
} from "./tmux-manager.js";

// Definition of Done checker
export {
  checkDoD,
  formatDoDChecks,
  isDoDPassed,
} from "./dod-checker.js";

// Monitor loop
export {
  getGlobalMonitor,
  startGlobalMonitor,
  stopGlobalMonitor,
  resetGlobalMonitor,
  type MonitorOptions,
  type MonitorLoop,
} from "./monitor-loop.js";

// Context management
export {
  loadContext,
  saveContext,
  syncContext,
  getCustomers,
  getProjects,
  getMeetings,
  getDecisions,
  getPatterns,
  getCustomerById,
  getProjectById,
  searchCustomers,
  searchProjects,
  searchMeetings,
  searchDecisions,
  searchPatterns,
  searchContext,
  upsertCustomer,
  upsertPattern,
  updatePatternEffectiveness,
  recommendPatterns,
  getContextSummary,
  clearContextCache,
} from "./context-manager.js";

// Obsidian sync
export {
  syncFromObsidian,
  findObsidianVault,
  type ObsidianConfig,
} from "./obsidian-sync.js";

// Context schema
export type {
  BusinessContext,
  Customer,
  Decision,
  Meeting,
  ObsidianConfig,
  Pattern,
  Project,
  ContextInjectionOptions,
  ContextualPrompt,
  ContextSearchResult,
} from "./context-schema.js";

// Prompt builder
export {
  buildContextualPrompt,
  buildPromptWithPattern,
  buildReviewPrompt,
  buildContextHint,
  formatCustomerForPrompt,
  formatProjectForPrompt,
  formatDecisionForPrompt,
} from "./prompt-builder.js";

// Code reviewer
export {
  runMultiModelReview,
  postReviewComments,
  shouldRequestChanges,
  formatReviewForTerminal,
  reviewToDoDChecks,
  type ReviewComment,
  type ReviewResult,
  type CombinedReview,
  type CodeReviewOptions,
} from "./code-reviewer.js";

// Review service (actual implementation)
export {
  runCodeReview,
  getDiffForReview,
  postReviewToPR,
  formatReviewForTerminal as formatReviewTerminal,
} from "./review-service.js";

// PR service
export {
  getCurrentBranch,
  getGitStatus,
  commitChanges,
  createPR,
  completeAgentWorkAndCreatePR,
  listOpenPRs,
  getPRDetails,
  type PRCreateOptions,
  type PRCreateResult,
} from "./pr-service.js";

// Workflow service
export {
  loadWorkflows,
  clearWorkflowsCache,
  getWorkflow,
  getWorkflowByName,
  createWorkflow,
  updateWorkflow,
  deleteWorkflow,
  listWorkflows as listAllWorkflows,
  dryRunWorkflow,
  incrementWorkflowRunCount,
  searchWorkflows,
  getPopularWorkflows,
  type Workflow,
  type WorkflowStep,
  type WorkflowExecutionResult,
} from "./workflow-service.js";

// Alias service
export {
  loadAliases,
  clearAliasesCache,
  getAlias,
  createAlias,
  deleteAlias,
  listAliases,
  incrementAliasUsage,
  getQuickActions,
  searchAliases,
  BUILT_IN_QUICK_ACTIONS,
  type Alias,
  type QuickAction,
} from "./alias-service.js";

// Babysit loop
export {
  startBabysitLoop,
  stopBabysitLoop,
  getBabysitStatus,
  runBabysitCheck,
  retryTask,
  getTasksNeedingAttention,
  type BabysitConfig,
} from "./babysit-loop.js";

// Retry strategy
export {
  analyzeFailure,
  selectRetryStrategy,
  selectAlternativeAgent,
  buildRetryPrompt,
  getRetryDelay,
  formatFailureAnalysis,
  type FailureAnalysis,
  type FailureCategory,
  type RetryAction,
} from "./retry-strategy.js";

// Command palette
export {
  fuzzyMatch,
  scoreMatch,
  loadPaletteItems,
  searchPalette,
  executePaletteItem,
  getPaletteCategories,
  getItemsByCategory,
  getPopularItems,
  type PaletteItem,
  type PaletteItemType,
  type PaletteExecuteResult,
  type PaletteSearchOptions,
  type PaletteSearchResult,
} from "./command-palette.js";

// Workflows (parameterized command templates - distinct from workflow-service)
export {
  loadWorkflows as loadCommandWorkflows,
  executeWorkflow,
  listWorkflowNames,
  completeWorkflowName,
  type Workflow as CommandWorkflow,
  type WorkflowParameter,
  type WorkflowExecuteResult,
} from "./workflows.js";

// Blocks UI
export {
  createBlock,
  addBlockOutput,
  finalizeBlock,
  cancelBlock,
  toggleBlockCollapsed,
  computeBlockStats,
  formatBlock,
  getStatusIcon,
  formatDuration,
  searchInBlock,
  getBlockOutputAsText,
  getBlockOutputAsJSON,
  createBlockShareLink,
  parseBlockShareLink,
  filterBlocks,
  sortBlocks,
  getBlockSummary,
  type CommandBlock,
  type BlockStatus,
  type BlockOutputLine,
  type CommandBlockMetadata,
  type CommandBlockStats,
  type BlockCreateOptions,
  type BlockSearchOptions,
  type BlockSearchResult,
} from "./blocks.js";
