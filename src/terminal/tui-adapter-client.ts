/**
 * Gap info from Gateway
 */
export type GatewayGapInfo = {
  expected: number;
  received: number;
};

/**
 * Degraded event payload
 */
export type DegradedEventPayload = {
  reason: string;
  missedHeartbeats: number;
};

/**
 * TUI-compatible adapter client
 *
 * This class wraps TerminalAdapter and exposes the same interface
 * as GatewayChatClient, allowing TUI to work with both modes.
 */
export class TuiAdapterClient {
  private adapter: TerminalAdapter;
  private eventHandler?: (evt: GatewayEvent) => void;
  private connectedHandler?: () => void;
  private disconnectedHandler?: (reason: string) => void;
  private gapHandler?: (info: GatewayGapInfo) => void;
  private degradedHandler?: (payload: DegradedEventPayload) => void;

  // Expose adapter mode and connection info
  readonly mode: "gateway" | "local";
  readonly connection: AdapterConnection;

  constructor(adapter: TerminalAdapter) {
    this.adapter = adapter;
    this.mode = adapter.mode;

    // Get connection info from adapter
    if ("connection" in adapter) {
      this.connection = (adapter as { connection: AdapterConnection }).connection;
    } else {
      this.connection = { url: adapter.mode === "local" ? "local://embedded" : "ws://localhost:18789" };
    }

    // Forward adapter events to TUI
    adapter.onEvent((event) => {
      if (event.type === "degraded") {
        // Handle degraded event specifically
        if (this.degradedHandler) {
          this.degradedHandler(event.payload as DegradedEventPayload);
        }
        // Also forward as status event
        if (this.eventHandler) {
          this.eventHandler({
            event: "status",
            payload: event.payload,
          });
        }
      } else if (this.eventHandler) {
        this.eventHandler({
          event: event.type,
          payload: event.payload as Record<string, unknown>,
          seq: undefined,
        });
      }
    });
  }

  /**
   * Set event handler (required by TUI)
   */
  set onEvent(handler: (evt: GatewayEvent) => void) {
    this.eventHandler = handler;
  }

  /**
   * Set connected handler (required by TUI)
   */
  set onConnected(handler: () => void) {
    this.connectedHandler = handler;
    this.adapter.onConnected?.(handler);
  }

  /**
   * Set disconnected handler (required by TUI)
   */
  set onDisconnected(handler: (reason: string) => void): void {
    this.disconnectedHandler = handler;
    this.adapter.onDisconnected?.(handler);
  }

  /**
   * Set gap handler (Gateway-specific, no-op for local mode)
   */
  set onGap(handler: (info: GatewayGapInfo) => void) {
    this.gapHandler = handler;
  }

  /**
   * Set degraded handler (for runtime degradation)
   */
  set onDegraded(handler: (payload: DegradedEventPayload) => void): void {
    this.degradedHandler = handler;
  }

  /**
   * Start the adapter
   */
  async start(): Promise<void> {
    await this.adapter.start();

    // Trigger connected handler if already ready
    if (this.adapter.isReady() && this.connectedHandler) {
      this.connectedHandler();
    }
  }

  /**
   * Stop/close the adapter
   */
  stop(): void {
    this.adapter.stop();
  }

  /**
   * Alias for stop (GatewayChatClient compatibility)
   */
  close(): void {
    this.stop();
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.adapter.isReady();
  }

  /**
   * Wait for ready state
   */
  async ready(): Promise<void> {
    await this.adapter.start();
  }

  /**
   * Get the underlying adapter
   */
  getAdapter(): TerminalAdapter {
    return this.adapter;
  }

  /**
   * Check if adapter is in degraded state (Gateway mode only)
   */
  isDegraded(): boolean {
    if (this.mode === "local") {
      return false;
    }
    const gwAdapter = this.adapter as { isDegraded?: () => boolean };
    return gwAdapter.isDegraded?.() ?? false;
  }

  /**
   * Reset degraded state (after reconnection)
   */
  resetDegraded(): void {
    if (this.mode === "local") {
      return;
    }
    const gwAdapter = this.adapter as { resetDegraded?: () => void };
    gwAdapter.resetDegraded?.();
  }
}
