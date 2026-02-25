// ANSI color codes and style parsing
export type AnsiStyle = {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
  backgroundColor?: string;
};

// ANSI SGR (Select Graphic Rendition) codes mapping
const SGR_CODES: Record<number, Partial<AnsiStyle>> = {
  // Styles
  0: {}, // Reset
  1: { bold: true },
  2: { dim: true },
  3: { italic: true },
  4: { underline: true },
  7: {}, // Inverse (not implemented)
  22: { bold: false, dim: false },
  23: { italic: false },
  24: { underline: false },

  // Foreground colors (normal)
  30: { color: "#000000" }, // Black
  31: { color: "#cd3131" }, // Red
  32: { color: "#0dbc79" }, // Green
  33: { color: "#e5e510" }, // Yellow
  34: { color: "#2472c8" }, // Blue
  35: { color: "#bc3fbc" }, // Magenta
  36: { color: "#11a8cd" }, // Cyan
  37: { color: "#e5e5e5" }, // White

  // Foreground colors (bright)
  90: { color: "#666666" }, // Bright Black
  91: { color: "#f14c4c" }, // Bright Red
  92: { color: "#23d18b" }, // Bright Green
  93: { color: "#f5f543" }, // Bright Yellow
  94: { color: "#3b8eea" }, // Bright Blue
  95: { color: "#d670d6" }, // Bright Magenta
  96: { color: "#29b8db" }, // Bright Cyan
  97: { color: "#ffffff" }, // Bright White

  // Background colors (normal)
  40: { backgroundColor: "#000000" }, // Black
  41: { backgroundColor: "#cd3131" }, // Red
  42: { backgroundColor: "#0dbc79" }, // Green
  43: { backgroundColor: "#e5e510" }, // Yellow
  44: { backgroundColor: "#2472c8" }, // Blue
  45: { backgroundColor: "#bc3fbc" }, // Magenta
  46: { backgroundColor: "#11a8cd" }, // Cyan
  47: { backgroundColor: "#e5e5e5" }, // White

  // Background colors (bright)
  100: { backgroundColor: "#666666" }, // Bright Black
  101: { backgroundColor: "#f14c4c" }, // Bright Red
  102: { backgroundColor: "#23d18b" }, // Bright Green
  103: { backgroundColor: "#f5f543" }, // Bright Yellow
  104: { backgroundColor: "#3b8eea" }, // Bright Blue
  105: { backgroundColor: "#d670d6" }, // Bright Magenta
  106: { backgroundColor: "#29b8db" }, // Bright Cyan
  107: { backgroundColor: "#ffffff" }, // Bright White
};

function applyStyle(style: AnsiStyle): string {
  const parts: string[] = [];

  if (style.bold) parts.push("font-weight: bold");
  if (style.dim) parts.push("opacity: 0.7");
  if (style.italic) parts.push("font-style: italic");
  if (style.underline) parts.push("text-decoration: underline");
  if (style.color) parts.push(`color: ${style.color}`);
  if (style.backgroundColor) parts.push(`background-color: ${style.backgroundColor}`);

  return parts.length > 0 ? `style="${parts.join("; ")}"` : "";
}

function mergeStyles(base: AnsiStyle, override: Partial<AnsiStyle>): AnsiStyle {
  const result: AnsiStyle = { ...base };

  for (const key in override) {
    const value = override[key as keyof AnsiStyle];
    if (value !== undefined) {
      if (key === "bold" && value === false) {
        delete result.bold;
      } else if (key === "dim" && value === false) {
        delete result.dim;
      } else if (key === "italic" && value === false) {
        delete result.italic;
      } else if (key === "underline" && value === false) {
        delete result.underline;
      } else {
        (result as any)[key] = value;
      }
    }
  }

  return result;
}

interface TextSegment {
  text: string;
  style: AnsiStyle;
}

// Parse ANSI escape sequences and convert to HTML
export function ansiToHtml(text: string): string {
  // First, handle non-color ANSI sequences
  let result = text;
  result = result.replace(/\x1b\[[0-9;]*G/g, ""); // Cursor position
  result = result.replace(/\x1b\[[0-9;]*H/g, ""); // Cursor position
  result = result.replace(/\x1b\[2K/g, ""); // Clear line
  result = result.replace(/\x1b\[\?[25][lh]/g, ""); // Show/hide cursor
  result = result.replace(/\x1b\[\?2004[lh]/g, ""); // Bracketed paste mode
  result = result.replace(/\x1b=\x1b\>/g, ""); // Application keypad mode

  // Now parse color sequences
  const segments: TextSegment[] = [];
  let currentStyle: AnsiStyle = {};
  let currentIndex = 0;

  // Match ANSI escape sequences: \x1b[...m or \033[...m
  const ansiRegex = /\x1b\[([0-9;]*)m/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = ansiRegex.exec(result)) !== null) {
    // Add text before this escape sequence
    if (match.index > lastIndex) {
      segments.push({
        text: escapeHtml(result.slice(lastIndex, match.index)),
        style: { ...currentStyle },
      });
    }

    // Parse the SGR codes
    const codesStr = match[1];
    if (codesStr === "" || codesStr === "0") {
      currentStyle = {};
    } else {
      const codes = codesStr.split(";").map(Number);
      for (const code of codes) {
        const styleChange = SGR_CODES[code];
        if (styleChange) {
          currentStyle = mergeStyles(currentStyle, styleChange);
        }
      }
    }

    lastIndex = ansiRegex.lastIndex;
  }

  // Add remaining text
  if (lastIndex < result.length) {
    segments.push({
      text: escapeHtml(result.slice(lastIndex)),
      style: { ...currentStyle },
    });
  }

  // Convert segments to HTML
  if (segments.length === 0) {
    return escapeHtml(result);
  }

  let html = "";
  let lastStyle = JSON.stringify({});

  for (const segment of segments) {
    const styleKey = JSON.stringify(segment.style);
    const styleAttr = applyStyle(segment.style);

    if (Object.keys(segment.style).length === 0) {
      html += segment.text;
    } else if (styleKey === lastStyle) {
      html += segment.text;
    } else {
      html += `<span ${styleAttr}>${segment.text}</span>`;
      lastStyle = styleKey;
    }
  }

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Simple version that just strips ANSI codes
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}
