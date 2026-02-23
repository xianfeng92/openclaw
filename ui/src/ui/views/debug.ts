import { html, nothing } from "lit";
import type { EventLogEntry } from "../app-events.ts";
import type {
  NeuroDistributionStats,
  NeuroFlagKey,
  NeuroFlagsSnapshot,
  NeuroMetricsSnapshot,
} from "../controllers/debug.ts";
import { formatEventPayload } from "../presenter.ts";

export type DebugProps = {
  loading: boolean;
  status: Record<string, unknown> | null;
  health: Record<string, unknown> | null;
  models: unknown[];
  heartbeat: unknown;
  neuroFlags: NeuroFlagsSnapshot | null;
  neuroMetrics: NeuroMetricsSnapshot | null;
  neuroSaving: boolean;
  neuroError: string | null;
  eventLog: EventLogEntry[];
  callMethod: string;
  callParams: string;
  callResult: string | null;
  callError: string | null;
  onToggleFlag: (key: NeuroFlagKey, enabled: boolean) => void;
  onCallMethodChange: (next: string) => void;
  onCallParamsChange: (next: string) => void;
  onRefresh: () => void;
  onCall: () => void;
};

type FlagItem = {
  key: NeuroFlagKey;
  label: string;
  description: string;
};

const FLAG_ITEMS: FlagItem[] = [
  {
    key: "proactiveCards",
    label: "Proactive Cards",
    description: "Show proactive suggestion cards without explicit prompt.",
  },
  {
    key: "flowMode",
    label: "Flow Mode",
    description: "Enable faster, less interruptive apply path where policy allows.",
  },
  {
    key: "preferenceSync",
    label: "Preference Sync",
    description: "Enable multi-device preference sync path for Neuro behavior.",
  },
  {
    key: "killSwitch",
    label: "Kill Switch",
    description: "Hard disable Neuro proactive and flow capabilities at runtime.",
  },
];

function formatMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${Math.round(value)}ms`;
}

function formatMb(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return `${value.toFixed(1)} MB`;
}

function formatTime(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "n/a";
  }
  return new Date(value).toLocaleTimeString();
}

function resolveBarWidth(value: number | null, max: number): string {
  if (value == null || !Number.isFinite(value) || max <= 0) {
    return "0%";
  }
  const ratio = Math.max(0, Math.min(1, value / max));
  return `${Math.max(6, Math.round(ratio * 100))}%`;
}

function renderLatencyPanel(params: {
  title: string;
  metricId: string;
  stats: NeuroDistributionStats | null;
  targetMs: number;
}) {
  const stats = params.stats;
  if (!stats) {
    return html`
      <div class="card" style="padding: 14px;">
        <div class="card-title">${params.title}</div>
        <div class="card-sub">${params.metricId}</div>
        <div class="muted" style="margin-top: 10px;">No samples yet.</div>
      </div>
    `;
  }

  const maxValue = Math.max(params.targetMs, stats.max ?? 0, stats.p95 ?? 0, stats.p50 ?? 0, 1);

  return html`
    <div class="card" style="padding: 14px;">
      <div class="card-title">${params.title}</div>
      <div class="card-sub">${params.metricId}</div>
      <div class="stat-grid" style="margin-top: 10px;">
        <div class="stat">
          <div class="stat-label">Samples</div>
          <div class="stat-value">${stats.count}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Avg</div>
          <div class="stat-value">${formatMs(stats.avg)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Min</div>
          <div class="stat-value">${formatMs(stats.min)}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Max</div>
          <div class="stat-value">${formatMs(stats.max)}</div>
        </div>
      </div>

      <div style="margin-top: 12px; display: grid; gap: 8px;">
        <div>
          <div class="list-sub">p50: ${formatMs(stats.p50)}</div>
          <div
            style="height: 8px; border-radius: 999px; background: var(--secondary); border: 1px solid var(--border); overflow: hidden;"
          >
            <div
              style=${`height: 100%; width: ${resolveBarWidth(stats.p50, maxValue)}; background: linear-gradient(90deg, var(--accent), #4ade80);`}
            ></div>
          </div>
        </div>
        <div>
          <div class="list-sub">p95: ${formatMs(stats.p95)} (target: ${params.targetMs}ms)</div>
          <div
            style="height: 8px; border-radius: 999px; background: var(--secondary); border: 1px solid var(--border); overflow: hidden;"
          >
            <div
              style=${`height: 100%; width: ${resolveBarWidth(stats.p95, maxValue)}; background: linear-gradient(90deg, #f97316, #ef4444);`}
            ></div>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderFlagRow(props: {
  flags: NeuroFlagsSnapshot;
  item: FlagItem;
  disabled: boolean;
  onToggleFlag: (key: NeuroFlagKey, enabled: boolean) => void;
}) {
  const configured = props.flags.configured[props.item.key];
  const effective = props.flags.effective[props.item.key];
  const isSuppressed = configured && !effective && props.flags.effective.killSwitch;
  return html`
    <div
      class="list-item"
      style="grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px;"
    >
      <div class="list-main">
        <div class="list-title">${props.item.label}</div>
        <div class="list-sub">${props.item.description}</div>
        <div class="list-sub">
          configured=${configured ? "on" : "off"} · effective=${effective ? "on" : "off"}
          ${isSuppressed ? " · suppressed by kill switch" : ""}
        </div>
      </div>
      <label class="field" style="margin: 0; display: inline-flex; align-items: center; gap: 8px;">
        <input
          data-neuro-flag=${props.item.key}
          type="checkbox"
          ?checked=${configured}
          ?disabled=${props.disabled}
          @change=${(event: Event) =>
            props.onToggleFlag(props.item.key, (event.target as HTMLInputElement).checked)}
        />
        <span>${configured ? "On" : "Off"}</span>
      </label>
    </div>
  `;
}

export function renderDebug(props: DebugProps) {
  const securityAudit =
    props.status && typeof props.status === "object"
      ? (props.status as { securityAudit?: { summary?: Record<string, number> } }).securityAudit
      : null;
  const securitySummary = securityAudit?.summary ?? null;
  const critical = securitySummary?.critical ?? 0;
  const warn = securitySummary?.warn ?? 0;
  const info = securitySummary?.info ?? 0;
  const securityTone = critical > 0 ? "danger" : warn > 0 ? "warn" : "success";
  const securityLabel =
    critical > 0 ? `${critical} critical` : warn > 0 ? `${warn} warnings` : "No critical issues";

  return html`
    <section class="grid grid-cols-2">
      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Snapshots</div>
            <div class="card-sub">Status, health, and heartbeat data.</div>
          </div>
          <button class="btn" ?disabled=${props.loading} @click=${props.onRefresh}>
            ${props.loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div class="stack" style="margin-top: 12px;">
          <div>
            <div class="muted">Status</div>
            ${
              securitySummary
                ? html`<div class="callout ${securityTone}" style="margin-top: 8px;">
                  Security audit: ${securityLabel}${info > 0 ? ` · ${info} info` : ""}. Run
                  <span class="mono">openclaw security audit --deep</span> for details.
                </div>`
                : nothing
            }
            <pre class="code-block">${JSON.stringify(props.status ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">Health</div>
            <pre class="code-block">${JSON.stringify(props.health ?? {}, null, 2)}</pre>
          </div>
          <div>
            <div class="muted">Last heartbeat</div>
            <pre class="code-block">${JSON.stringify(props.heartbeat ?? {}, null, 2)}</pre>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Manual RPC</div>
        <div class="card-sub">Send a raw gateway method with JSON params.</div>
        <div class="form-grid" style="margin-top: 16px;">
          <label class="field">
            <span>Method</span>
            <input
              .value=${props.callMethod}
              @input=${(e: Event) => props.onCallMethodChange((e.target as HTMLInputElement).value)}
              placeholder="system-presence"
            />
          </label>
          <label class="field">
            <span>Params (JSON)</span>
            <textarea
              .value=${props.callParams}
              @input=${(e: Event) =>
                props.onCallParamsChange((e.target as HTMLTextAreaElement).value)}
              rows="6"
            ></textarea>
          </label>
        </div>
        <div class="row" style="margin-top: 12px;">
          <button class="btn primary" @click=${props.onCall}>Call</button>
        </div>
        ${
          props.callError
            ? html`<div class="callout danger" style="margin-top: 12px;">
              ${props.callError}
            </div>`
            : nothing
        }
        ${
          props.callResult
            ? html`<pre class="code-block" style="margin-top: 12px;">${props.callResult}</pre>`
            : nothing
        }
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-top: 18px;">
      <div class="card">
        <div class="row" style="justify-content: space-between;">
          <div>
            <div class="card-title">Neuro Flags</div>
            <div class="card-sub">Runtime feature flags and kill switch state.</div>
          </div>
          ${
            props.neuroFlags
              ? html`<div class="pill">
                version <span class="mono">${props.neuroFlags.version}</span>
              </div>`
              : nothing
          }
        </div>
        ${
          props.neuroError
            ? html`<div class="callout warn" style="margin-top: 12px;">${props.neuroError}</div>`
            : nothing
        }
        ${
          props.neuroFlags
            ? html`
                <div class="list" style="margin-top: 12px;">
                  ${FLAG_ITEMS.map((item) =>
                    renderFlagRow({
                      flags: props.neuroFlags as NeuroFlagsSnapshot,
                      item,
                      disabled: props.neuroSaving || props.loading,
                      onToggleFlag: props.onToggleFlag,
                    }),
                  )}
                </div>
                <div class="list-sub" style="margin-top: 10px;">
                  Updated: ${new Date(props.neuroFlags.updatedAtMs).toLocaleTimeString()}
                </div>
              `
            : html`
                <div class="muted" style="margin-top: 12px">
                  No Neuro flags payload yet. Click Refresh after gateway connection.
                </div>
              `
        }
      </div>

      <div class="card">
        <div class="card-title">Neuro Metrics</div>
        <div class="card-sub">Invoke latency, memory usage, and redaction counters.</div>
        ${
          props.neuroMetrics
            ? html`
                <div class="stat-grid" style="margin-top: 12px;">
                  <div class="stat">
                    <div class="stat-label">Gateway RSS</div>
                    <div class="stat-value">${formatMb(props.neuroMetrics.memory.gatewayMb.rss)}</div>
                  </div>
                  <div class="stat">
                    <div class="stat-label">Gateway Heap Used</div>
                    <div class="stat-value">
                      ${formatMb(props.neuroMetrics.memory.gatewayMb.heapUsed)}
                    </div>
                  </div>
                  <div class="stat">
                    <div class="stat-label">Desktop Memory</div>
                    <div class="stat-value">${formatMb(props.neuroMetrics.memory.desktopMb)}</div>
                  </div>
                  <div class="stat">
                    <div class="stat-label">Desktop Updated</div>
                    <div class="stat-value">
                      ${formatTime(props.neuroMetrics.memory.desktopUpdatedAtMs)}
                    </div>
                  </div>
                </div>
                <div class="row" style="margin-top: 10px; gap: 8px;">
                  <div class="pill">mask=${props.neuroMetrics.redaction.maskCount}</div>
                  <div class="pill">block=${props.neuroMetrics.redaction.blockCount}</div>
                </div>
              `
            : html`
                <div class="muted" style="margin-top: 12px">
                  No Neuro metrics payload yet. Click Refresh after gateway connection.
                </div>
              `
        }
      </div>
    </section>

    <section class="grid grid-cols-2" style="margin-top: 18px;">
      ${renderLatencyPanel({
        title: "UI Ready Latency",
        metricId: "neuro.invoke.ui_ready_ms",
        stats: props.neuroMetrics?.invoke.uiReadyMs ?? null,
        targetMs: 100,
      })}
      ${renderLatencyPanel({
        title: "First Token Latency",
        metricId: "neuro.invoke.first_token_ms",
        stats: props.neuroMetrics?.invoke.firstTokenMs ?? null,
        targetMs: 2000,
      })}
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Models</div>
      <div class="card-sub">Catalog from models.list.</div>
      <pre class="code-block" style="margin-top: 12px;">${JSON.stringify(
        props.models ?? [],
        null,
        2,
      )}</pre>
    </section>

    <section class="card" style="margin-top: 18px;">
      <div class="card-title">Event Log</div>
      <div class="card-sub">Latest gateway events.</div>
      ${
        props.eventLog.length === 0
          ? html`
              <div class="muted" style="margin-top: 12px">No events yet.</div>
            `
          : html`
            <div class="list" style="margin-top: 12px;">
              ${props.eventLog.map(
                (evt) => html`
                  <div class="list-item" style="grid-template-columns: minmax(0, 1fr);">
                    <div class="list-main">
                      <div class="list-title">${evt.event}</div>
                      <div class="list-sub">
                        ${new Date(evt.ts).toLocaleTimeString()} · seq=${evt.seq ?? "-"} · run=${
                          evt.runId ?? "-"
                        } · stream=${evt.stream ?? "-"}
                      </div>
                    </div>
                    <div class="list-meta" style="text-align: left; min-width: 0;">
                      <pre class="code-block">${formatEventPayload(evt.payload)}</pre>
                    </div>
                  </div>
                `,
              )}
            </div>
          `
      }
    </section>
  `;
}
