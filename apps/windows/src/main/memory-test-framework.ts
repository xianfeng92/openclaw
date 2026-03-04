import fs from "node:fs";
import {
  appendSessionMemorySnapshot,
  memoryGet,
  memorySearch,
  type MemorySearchResult,
  type SessionSnapshotMessage,
  type SessionSnapshotReason,
} from "./memory-runtime.js";

export type MemoryEfficiencyCase = {
  name: string;
  query: string;
  expectedPhrases: string[];
  maxResults?: number;
  minScore?: number;
};

export type MemoryEfficiencyCaseResult = {
  name: string;
  latencyMs: number;
  hit: boolean;
  topScore: number;
  resultCount: number;
  matchedPhrase?: string;
  query: string;
};

export type MemoryEfficiencySuiteResult = {
  totalCases: number;
  hitCases: number;
  hitRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  cases: MemoryEfficiencyCaseResult[];
};

export type MemoryLossWrite = {
  messages: SessionSnapshotMessage[];
  reason?: SessionSnapshotReason;
  now?: Date;
};

export type MemoryLossCase = {
  name: string;
  sessionKey: string;
  writes: MemoryLossWrite[];
  validationQuery: string;
  expectedPhrases: string[];
};

export type MemoryLossCaseResult = {
  name: string;
  expectedCount: number;
  recoveredCount: number;
  missingPhrases: string[];
  createdFiles: string[];
  hit: boolean;
};

export type MemoryLossSuiteResult = {
  totalCases: number;
  hitCases: number;
  missingCases: number;
  lossRate: number;
  cases: MemoryLossCaseResult[];
};

export type MemoryCompressionCase = {
  name: string;
  sessionKey: string;
  messages: SessionSnapshotMessage[];
  triggerThreshold: number;
  snapshotMaxMessages: number;
  expectFlush?: boolean;
  maxMessageCompressionRatio?: number;
  now?: Date;
};

export type MemoryCompressionCaseResult = {
  name: string;
  flushed: boolean;
  passed: boolean;
  inputMessages: number;
  selectedMessages: number;
  inputChars: number;
  selectedChars: number;
  messageCompressionRatio: number;
  persistedCompressionRatio: number;
  relativePath?: string;
};

export type MemoryCompressionSuiteResult = {
  totalCases: number;
  passedCases: number;
  passRate: number;
  averageMessageCompressionRatio: number;
  cases: MemoryCompressionCaseResult[];
};

function nowMs(): number {
  return Date.now();
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function p95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted: number[] = [];
  for (const value of values) {
    const insertAt = sorted.findIndex((entry) => value < entry);
    if (insertAt === -1) {
      sorted.push(value);
    } else {
      sorted.splice(insertAt, 0, value);
    }
  }
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[index] ?? 0;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function gatherSearchCorpus(params: {
  workspacePath: string;
  results: MemorySearchResult[];
  fallbackSnippets: string[];
}): string {
  const sections: string[] = [...params.fallbackSnippets];
  for (const result of params.results) {
    sections.push(result.snippet);
    try {
      const from = Math.max(1, result.startLine - 2);
      const lines = Math.max(1, result.endLine - result.startLine + 6);
      const read = memoryGet(params.workspacePath, {
        path: result.path,
        from,
        lines,
      });
      sections.push(read.text);
    } catch {
      // Best effort enrichment for phrase matching.
    }
  }
  return normalize(sections.join("\n"));
}

function countChars(messages: SessionSnapshotMessage[]): number {
  return messages.reduce((sum, message) => sum + message.content.length, 0);
}

function runCompressionCase(workspacePath: string, testCase: MemoryCompressionCase): MemoryCompressionCaseResult {
  const inputMessages = testCase.messages.filter((message) => message.content.trim().length > 0);
  const inputChars = countChars(inputMessages);

  if (inputMessages.length < Math.max(1, Math.floor(testCase.triggerThreshold))) {
    const shouldSkip = testCase.expectFlush === false;
    return {
      name: testCase.name,
      flushed: false,
      passed: shouldSkip,
      inputMessages: inputMessages.length,
      selectedMessages: 0,
      inputChars,
      selectedChars: 0,
      messageCompressionRatio: 0,
      persistedCompressionRatio: 0,
    };
  }

  const snapshotMax = Math.max(1, Math.floor(testCase.snapshotMaxMessages));
  const selectedMessages = inputMessages.slice(-snapshotMax);
  const selectedChars = countChars(selectedMessages);
  const expectedFlush = testCase.expectFlush !== false;

  const memoryDir = `${workspacePath}/memory`;

  const preSize = (() => {
    try {
      let total = 0;
      if (!fs.existsSync(memoryDir)) {
        return 0;
      }
      for (const name of fs.readdirSync(memoryDir)) {
        const fullPath = `${memoryDir}/${name}`;
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          total += stat.size;
        }
      }
      return total;
    } catch {
      return 0;
    }
  })();

  const writeResult = appendSessionMemorySnapshot({
    workspacePath,
    sessionKey: testCase.sessionKey,
    reason: "pre-compaction-flush",
    messages: selectedMessages,
    now: testCase.now,
  });

  const postSize = (() => {
    try {
      let total = 0;
      if (!fs.existsSync(memoryDir)) {
        return 0;
      }
      for (const name of fs.readdirSync(memoryDir)) {
        const fullPath = `${memoryDir}/${name}`;
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          total += stat.size;
        }
      }
      return total;
    } catch {
      return preSize;
    }
  })();

  const messageCompressionRatio = inputChars > 0 ? selectedChars / inputChars : 0;
  const persistedCompressionRatio = inputChars > 0 ? Math.max(0, postSize - preSize) / inputChars : 0;

  let passed = writeResult.saved === expectedFlush;
  if (passed && expectedFlush && typeof testCase.maxMessageCompressionRatio === "number") {
    passed = messageCompressionRatio <= testCase.maxMessageCompressionRatio;
  }

  const relativePath = writeResult.relativePath;
  if (passed && expectedFlush && relativePath) {
    try {
      const content = fs.readFileSync(`${workspacePath}/${relativePath}`, "utf-8");
      passed = content.includes("pre-compaction-flush");
    } catch {
      passed = false;
    }
  }

  return {
    name: testCase.name,
    flushed: writeResult.saved,
    passed,
    inputMessages: inputMessages.length,
    selectedMessages: selectedMessages.length,
    inputChars,
    selectedChars,
    messageCompressionRatio,
    persistedCompressionRatio,
    relativePath: writeResult.relativePath,
  };
}

export class MemoryTestHarness {
  constructor(private readonly workspacePath: string) {}

  runEfficiencySuite(testCases: MemoryEfficiencyCase[]): MemoryEfficiencySuiteResult {
    const results: MemoryEfficiencyCaseResult[] = [];

    for (const testCase of testCases) {
      const startedAt = nowMs();
      const searchResults = memorySearch(this.workspacePath, testCase.query, {
        maxResults: testCase.maxResults,
        minScore: testCase.minScore,
      });
      const endedAt = nowMs();

      const corpus = gatherSearchCorpus({
        workspacePath: this.workspacePath,
        results: searchResults,
        fallbackSnippets: searchResults.map((entry) => entry.snippet),
      });

      let matchedPhrase: string | undefined;
      for (const phrase of testCase.expectedPhrases) {
        if (phrase && corpus.includes(normalize(phrase))) {
          matchedPhrase = phrase;
          break;
        }
      }

      const hit =
        testCase.expectedPhrases.length === 0 ? searchResults.length > 0 : Boolean(matchedPhrase);

      results.push({
        name: testCase.name,
        latencyMs: Math.max(0, endedAt - startedAt),
        hit,
        topScore: searchResults[0]?.score ?? 0,
        resultCount: searchResults.length,
        matchedPhrase,
        query: testCase.query,
      });
    }

    const latencyValues = results.map((entry) => entry.latencyMs);
    const hitCases = results.filter((entry) => entry.hit).length;
    const totalCases = results.length;
    return {
      totalCases,
      hitCases,
      hitRate: totalCases > 0 ? hitCases / totalCases : 0,
      averageLatencyMs: average(latencyValues),
      p95LatencyMs: p95(latencyValues),
      cases: results,
    };
  }

  runLossSuite(testCases: MemoryLossCase[]): MemoryLossSuiteResult {
    const results: MemoryLossCaseResult[] = [];

    for (const testCase of testCases) {
      const createdFiles: string[] = [];
      for (const write of testCase.writes) {
        const snapshot = appendSessionMemorySnapshot({
          workspacePath: this.workspacePath,
          sessionKey: testCase.sessionKey,
          reason: write.reason ?? "session-memory",
          messages: write.messages,
          now: write.now,
        });
        if (snapshot.saved) {
          createdFiles.push(snapshot.relativePath);
        }
      }

      const searchResults = memorySearch(this.workspacePath, testCase.validationQuery, {
        maxResults: 8,
        minScore: 0.05,
      });
      const corpus = gatherSearchCorpus({
        workspacePath: this.workspacePath,
        results: searchResults,
        fallbackSnippets: createdFiles,
      });

      const missingPhrases = testCase.expectedPhrases.filter(
        (phrase) => !corpus.includes(normalize(phrase)),
      );
      const recoveredCount = testCase.expectedPhrases.length - missingPhrases.length;

      results.push({
        name: testCase.name,
        expectedCount: testCase.expectedPhrases.length,
        recoveredCount,
        missingPhrases,
        createdFiles,
        hit: missingPhrases.length === 0,
      });
    }

    const totalCases = results.length;
    const hitCases = results.filter((entry) => entry.hit).length;
    const missingCases = totalCases - hitCases;
    return {
      totalCases,
      hitCases,
      missingCases,
      lossRate: totalCases > 0 ? missingCases / totalCases : 0,
      cases: results,
    };
  }

  runCompressionSuite(testCases: MemoryCompressionCase[]): MemoryCompressionSuiteResult {
    const results = testCases.map((testCase) => runCompressionCase(this.workspacePath, testCase));
    const totalCases = results.length;
    const passedCases = results.filter((entry) => entry.passed).length;
    return {
      totalCases,
      passedCases,
      passRate: totalCases > 0 ? passedCases / totalCases : 0,
      averageMessageCompressionRatio: average(results.map((entry) => entry.messageCompressionRatio)),
      cases: results,
    };
  }
}
