export type EventLogEntry = {
  ts: number;
  seq: number | null;
  event: string;
  runId?: string;
  stream?: string;
  payload?: unknown;
};
