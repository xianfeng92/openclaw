import AppKit
import Foundation
import WebKit

@MainActor
final class DashboardBridgeManager {
    static let shared = DashboardBridgeManager()

    private var controller: DashboardBridgeWindowController?

    func open(config: GatewayConnection.Config) throws {
        let dashboardURL = try GatewayEndpointStore.dashboardURL(for: config)
        let controller = self.controller ?? DashboardBridgeWindowController()
        controller.onWindowClosed = { [weak self] in
            self?.controller = nil
        }
        self.controller = controller
        controller.open(
            dashboardURL: dashboardURL,
            gatewayURL: config.url,
            token: config.token,
            password: config.password)
    }
}

@MainActor
private final class DashboardBridgeWindowController: NSObject, NSWindowDelegate {
    private static let defaultSize = NSSize(width: 1240, height: 860)
    private static let passwordSessionKey = "openclaw.control.password.v1"
    private static let uiSettingsStorageKey = "openclaw.control.settings.v1"

    private let webView: WKWebView
    private let window: NSWindow

    var onWindowClosed: (() -> Void)?

    override init() {
        let config = WKWebViewConfiguration()
        config.userContentController = WKUserContentController()
        #if DEBUG
            config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        #endif

        self.webView = WKWebView(frame: .zero, configuration: config)
        self.window = NSWindow(
            contentRect: NSRect(origin: .zero, size: Self.defaultSize),
            styleMask: [.titled, .closable, .resizable, .miniaturizable],
            backing: .buffered,
            defer: false)

        super.init()

        self.window.title = "OpenClaw Dashboard"
        self.window.contentView = self.webView
        self.window.delegate = self
        self.window.isReleasedWhenClosed = false
        self.window.center()
        self.window.minSize = NSSize(width: 980, height: 680)
        WindowPlacement.ensureOnScreen(window: self.window, defaultSize: Self.defaultSize)
    }

    func open(
        dashboardURL: URL,
        gatewayURL: URL,
        token: String?,
        password: String?)
    {
        self.installBootstrapScript(
            dashboardURL: dashboardURL,
            gatewayURL: gatewayURL,
            token: token,
            password: password)

        if let host = dashboardURL.host?.trimmingCharacters(in: .whitespacesAndNewlines),
           !host.isEmpty
        {
            self.window.title = "OpenClaw Dashboard (\(host))"
        } else {
            self.window.title = "OpenClaw Dashboard"
        }

        self.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        var request = URLRequest(url: dashboardURL)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        self.webView.load(request)
    }

    func windowWillClose(_: Notification) {
        self.onWindowClosed?()
    }

    private func installBootstrapScript(
        dashboardURL: URL,
        gatewayURL: URL,
        token: String?,
        password: String?)
    {
        let expectedHost = dashboardURL.host ?? ""
        let expectedPort = dashboardURL.port.map(String.init) ?? ""
        let trimmedToken = token?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let trimmedPassword = password?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var gatewayComponents = URLComponents(url: gatewayURL, resolvingAgainstBaseURL: false)
        gatewayComponents?.query = nil
        gatewayComponents?.fragment = nil
        let gatewayURLString = gatewayComponents?.url?.absoluteString ?? gatewayURL.absoluteString

        let script = """
        (() => {
          try {
            const expectedHost = \(Self.jsStringLiteral(expectedHost));
            const expectedPort = \(Self.jsStringLiteral(expectedPort));
            if (location.hostname !== expectedHost) return;
            if (location.port !== expectedPort) return;

            const settingsKey = \(Self.jsStringLiteral(Self.uiSettingsStorageKey));
            let parsed = {};
            const raw = localStorage.getItem(settingsKey);
            if (raw) {
              try {
                const candidate = JSON.parse(raw);
                if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
                  parsed = candidate;
                }
              } catch {}
            }

            parsed.gatewayUrl = \(Self.jsStringLiteral(gatewayURLString));

            const token = \(Self.jsStringLiteral(trimmedToken));
            if (token.length > 0) {
              parsed.token = token;
            } else {
              delete parsed.token;
            }

            localStorage.setItem(settingsKey, JSON.stringify(parsed));

            const passwordKey = \(Self.jsStringLiteral(Self.passwordSessionKey));
            const password = \(Self.jsStringLiteral(trimmedPassword));
            if (password.length > 0) {
              sessionStorage.setItem(passwordKey, password);
            } else {
              sessionStorage.removeItem(passwordKey);
            }
          } catch {}
        })();
        """

        let controller = self.webView.configuration.userContentController
        controller.removeAllUserScripts()
        controller.addUserScript(WKUserScript(
            source: script,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true))
    }

    private static func jsStringLiteral(_ value: String) -> String {
        let data = try? JSONEncoder().encode(value)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }
}
