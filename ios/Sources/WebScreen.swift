import SwiftUI
import WebKit

/// Состояние загрузки страницы: ошибка и перезагрузка.
final class WebModel: ObservableObject {
    @Published var error: String?
    weak var webView: WKWebView?

    func reload(_ url: URL) {
        error = nil
        if let webView, webView.url != nil { webView.reload() } else { webView?.load(URLRequest(url: url)) }
    }
}

/// Сайт на весь экран плюс сообщение, если сервер не отвечает.
struct WebScreen: View {
    let url: URL
    let onTheme: (Color, Bool) -> Void
    let onChangeServer: () -> Void
    @StateObject private var model = WebModel()

    var body: some View {
        ZStack {
            WebView(url: url, model: model, onTheme: onTheme, onChangeServer: onChangeServer)
            if let message = model.error {
                VStack(spacing: 14) {
                    Text("Нет связи с сервером")
                        .font(.title3.weight(.semibold))
                    Text(message)
                        .font(.footnote)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                    Text(url.absoluteString)
                        .font(.caption.monospaced())
                        .foregroundColor(.secondary)
                    Button("Повторить") { model.reload(url) }
                        .buttonStyle(.borderedProminent)
                    Button("Изменить адрес", action: onChangeServer)
                }
                .padding(24)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(UIColor.systemBackground).opacity(0.96))
            }
        }
    }
}

struct WebView: UIViewRepresentable {
    let url: URL
    let model: WebModel
    let onTheme: (Color, Bool) -> Void
    let onChangeServer: () -> Void

    /// Сайт меняет <meta name="theme-color"> вместе с темой (ночь, день, «Авто») — сообщаем об этом приложению
    private static let themeScript = """
    (function () {
      function send() {
        var m = document.querySelector('meta[name="theme-color"]');
        if (m && window.webkit && window.webkit.messageHandlers.theme) window.webkit.messageHandlers.theme.postMessage(m.content);
      }
      new MutationObserver(send).observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ['content'] });
      send();
    })();
    """

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "theme")
        controller.addUserScript(WKUserScript(source: Self.themeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = controller

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { view.isInspectable = true }   // отладка: Safari → Разработка → iPhone

        // тайный жест: двойное касание тремя пальцами — сменить адрес сервера
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.threeFingerTap))
        tap.numberOfTouchesRequired = 3
        tap.numberOfTapsRequired = 2
        tap.cancelsTouchesInView = false
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)

        model.webView = view
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        context.coordinator.parent = self
    }

    static func dismantleUIView(_ uiView: WKWebView, coordinator: Coordinator) {
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "theme")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
        var parent: WebView
        init(_ parent: WebView) { self.parent = parent }

        // MARK: тема
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "theme", let css = message.body as? String, let rgb = Self.parseColor(css) else { return }
            let color = Color(red: rgb.0, green: rgb.1, blue: rgb.2)
            let luminance = 0.2126 * rgb.0 + 0.7152 * rgb.1 + 0.0722 * rgb.2
            DispatchQueue.main.async { self.parent.onTheme(color, luminance < 0.5) }
        }

        /// «rgb(11 22 40)», «rgb(11, 22, 40)» или «#0B1628»
        static func parseColor(_ css: String) -> (Double, Double, Double)? {
            let s = css.trimmingCharacters(in: .whitespaces).lowercased()
            if s.hasPrefix("#"), s.count == 7, let v = Int(s.dropFirst(), radix: 16) {
                return (Double((v >> 16) & 255) / 255, Double((v >> 8) & 255) / 255, Double(v & 255) / 255)
            }
            let nums = s.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
            guard s.hasPrefix("rgb"), nums.count >= 3 else { return nil }
            return (nums[0] / 255, nums[1] / 255, nums[2] / 255)
        }

        // MARK: загрузка
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async { self.parent.model.error = nil }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error) }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error) }

        private func fail(_ error: Error) {
            let e = error as NSError
            if e.domain == NSURLErrorDomain && e.code == NSURLErrorCancelled { return }
            DispatchQueue.main.async { self.parent.model.error = e.localizedDescription }
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                     decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if navigationResponse.isForMainFrame, let http = navigationResponse.response as? HTTPURLResponse, http.statusCode >= 400 {
                DispatchQueue.main.async { self.parent.model.error = "Сервер ответил кодом \(http.statusCode)" }
            }
            decisionHandler(.allow)
        }

        /// Ссылки на чужие сайты открываем в Safari, свой сервер — внутри приложения
        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            if navigationAction.navigationType == .linkActivated, let target = navigationAction.request.url,
               target.host != parent.url.host {
                UIApplication.shared.open(target)
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        /// window.open и target=_blank — тоже наружу
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                     for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            if let target = navigationAction.request.url { UIApplication.shared.open(target) }
            return nil
        }

        // MARK: жест
        @objc func threeFingerTap() { parent.onChangeServer() }

        func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}
