import { describe, expect, it } from "vitest";
import { buildAgentMessageWithContext } from "./windows-agent-manager.js";

describe("buildAgentMessageWithContext", () => {
  it("always injects Windows runtime guardrails before task content", () => {
    const description = "Implement login retry logic";
    const message = buildAgentMessageWithContext(description);
    expect(message).toContain("[cydeck:runtime] Windows shell (PowerShell/CMD).");
    expect(message).toContain("Shell defaults to cmd.exe. Use cmd-compatible commands");
    expect(message).toContain("Do not run bare PowerShell cmdlets (Get-ChildItem, Select-String)");
    expect(message).toContain("Do not assume rg exists");
    expect(message).toContain("Do not use schtasks/systemctl/launchctl/pkill");
    expect(message).toContain("Task:");
    expect(message).toContain(description);
  });

  it("injects agent profile and relevant context into the prompt", () => {
    const message = buildAgentMessageWithContext("Fix the payment retry bug", {
      agent: "claude",
      useContext: true,
      relevantContext: {
        customers: [
          { name: "Acme", score: 9 },
          { name: "BetaCorp", score: 4 },
        ],
        projects: [{ name: "Billing", score: 8 }],
        meetings: [{ title: "Weekly Billing Sync", score: 8 }],
        decisions: [{ title: "Retry max is 3", score: 7 }],
        patterns: [{ name: "BugFixTemplate", score: 6 }],
      },
    });

    expect(message).toContain("[cydeck:agent-profile] claude");
    expect(message).toContain("[cydeck:context]");
    expect(message).toContain("[cydeck:gateway] Use CyDeck controls/commands instead");
    expect(message).toContain("Customers: Acme, BetaCorp");
    expect(message).toContain("Projects: Billing");
    expect(message).toContain("Meetings: Weekly Billing Sync");
    expect(message).toContain("Decisions: Retry max is 3");
    expect(message).toContain("Patterns: BugFixTemplate");
    expect(message).toContain("Task:");
    expect(message).toContain("Fix the payment retry bug");
  });
});
