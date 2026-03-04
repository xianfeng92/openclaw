import { describe, expect, it } from "vitest";
import {
  resolveTerminalAutocomplete,
  type ResolveTerminalAutocompleteResult,
  type TerminalAutocompleteState,
} from "./autocomplete.js";

function complete(
  input: string,
  previousState: TerminalAutocompleteState | null = null,
): ResolveTerminalAutocompleteResult {
  return resolveTerminalAutocomplete({
    input,
    cursorPos: input.length,
    isWindows: true,
    previousState,
  });
}

describe("terminal autocomplete", () => {
  it("completes unique top-level slash commands", () => {
    const result = complete("/la");
    expect(result.didComplete).toBe(true);
    expect(result.value).toBe("/landing ");
    expect(result.state).toBeNull();
  });

  it("cycles slash command completions on repeated tab", () => {
    const first = complete("/co");
    expect(first.value).toBe("/config");
    expect(first.state).not.toBeNull();

    const second = complete(first.value, first.state);
    expect(second.value).toBe("/connect");
    expect(second.state).not.toBeNull();

    const third = complete(second.value, second.state);
    expect(third.value).toBe("/context");
  });

  it("completes /landing subcommands and cycles options", () => {
    const first = complete("/landing s");
    expect(first.value).toBe("/landing status");
    expect(first.state).not.toBeNull();

    const second = complete(first.value, first.state);
    expect(second.value).toBe("/landing start");

    const third = complete(second.value, second.state);
    expect(third.value).toBe("/landing set");
  });

  it("completes /landing set key names", () => {
    const result = complete("/landing set user.ti");
    expect(result.value).toBe("/landing set user.timezone ");
  });

  it("completes new landing wizard subcommands", () => {
    const cancel = complete("/landing c");
    expect(cancel.value).toBe("/landing cancel ");

    const resume = complete("/landing r");
    expect(resume.value).toBe("/landing resume ");
  });

  it("completes /landing start flags", () => {
    const reset = complete("/landing start --r");
    expect(reset.value).toBe("/landing start --reset ");
  });

  it("completes /config set key names and values", () => {
    const keyResult = complete("/config set ai.providers.google.mo");
    expect(keyResult.value).toBe("/config set ai.providers.google.model ");

    const providerResult = complete("/config set ai.defaultProvider g");
    expect(providerResult.value).toBe("/config set ai.defaultProvider google ");
  });

  it("completes shell commands", () => {
    const result = complete("!gi");
    expect(result.value).toBe("!git ");
    expect(result.state).toBeNull();
  });

  it("returns no completion when nothing matches", () => {
    const result = complete("/zzzz");
    expect(result.didComplete).toBe(false);
    expect(result.value).toBe("/zzzz");
  });
});
