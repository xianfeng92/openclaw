import chalk from "chalk";

type HighlightTheme = Record<string, (text: string) => string>;

/**
 * Syntax highlighting theme for code blocks.
 * Dracula-inspired theme matching the overall TUI aesthetic.
 * Uses chalk functions to style different token types.
 */
export function createSyntaxTheme(fallback: (text: string) => string): HighlightTheme {
  return {
    // Keywords - Dracula pink/magenta
    keyword: chalk.hex("#FF79C6"),
    "meta-keyword": chalk.hex("#FF79C6"),

    // Built-ins and types - Dracula cyan
    built_in: chalk.hex("#8BE9FD"),
    type: chalk.hex("#8BE9FD"),
    class: chalk.hex("#8BE9FD"),

    // Literals and booleans - Dracula purple
    literal: chalk.hex("#BD93F9"),
    number: chalk.hex("#BD93F9"),

    // Strings - Dracula green
    string: chalk.hex("#50FA7B"),
    "meta-string": chalk.hex("#50FA7B"),

    // Regex - Dracula orange
    regexp: chalk.hex("#FFB86C"),

    // Symbols - Dracula yellow
    symbol: chalk.hex("#F1FA8C"),

    // Functions and titles - Dracula green
    function: chalk.hex("#50FA7B"),
    title: chalk.hex("#50FA7B"),
    section: chalk.hex("#50FA7B"),

    // Parameters - Dracula cyan
    params: chalk.hex("#8BE9FD"),

    // Comments - Dracula comment gray
    comment: chalk.hex("#6272A4"),
    doctag: chalk.hex("#6272A4"),
    quote: chalk.hex("#6272A4"),

    // Meta - Dracula purple
    meta: chalk.hex("#BD93F9"),

    // HTML/XML tags - Dracula pink
    tag: chalk.hex("#FF79C6"),
    name: chalk.hex("#F8F8F2"),
    attr: chalk.hex("#8BE9FD"),
    attribute: chalk.hex("#8BE9FD"),
    variable: chalk.hex("#F8F8F2"),

    // Markdown bullets - Dracula yellow
    bullet: chalk.hex("#F1FA8C"),

    // Inline code - Dracula orange
    code: chalk.hex("#FFB86C"),

    // Text styling
    emphasis: chalk.italic,
    strong: chalk.bold,

    // Formula/math - Dracula pink
    formula: chalk.hex("#FF79C6"),

    // Links - Dracula cyan
    link: chalk.hex("#8BE9FD"),

    // Diff - green/red
    addition: chalk.hex("#50FA7B"),
    deletion: chalk.hex("#FF5555"),

    // CSS selectors - Dracula yellow
    "selector-tag": chalk.hex("#F1FA8C"),
    "selector-id": chalk.hex("#F1FA8C"),
    "selector-class": chalk.hex("#F1FA8C"),
    "selector-attr": chalk.hex("#8BE9FD"),
    "selector-pseudo": chalk.hex("#FF79C6"),

    // Templates
    "template-tag": chalk.hex("#FF79C6"),
    "template-variable": chalk.hex("#8BE9FD"),

    default: fallback,
  };
}
