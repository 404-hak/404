import SwiftUI
import WebKit

/// Состояние загрузки страницы: ошибка, готовность и перезагрузка.
final class WebModel: ObservableObject {
    @Published var error: String?
    @Published var loaded = false
    weak var webView: WKWebView?

    func reload(_ url: URL) {
        error = nil
        if let webView, webView.url != nil { webView.reload() } else { webView?.load(URLRequest(url: url)) }
    }
}

/// Сайт на весь экран, от края до края (под вырезом и «домашней» полосой), плюс сообщение, если сервер не отвечает.
struct WebScreen: View {
    let url: URL
    let background: Color
    let onTheme: (Color, Bool) -> Void
    let onChangeServer: () -> Void
    @StateObject private var model = WebModel()

    var body: some View {
        ZStack {
            WebView(url: url, model: model, onTheme: onTheme, onChangeServer: onChangeServer)
                .ignoresSafeArea(.container)   // клавиатура по-прежнему поднимает содержимое

            // пока страница грузится — цвет запуска, потом плавно открывается сайт (без белой вспышки)
            background
                .ignoresSafeArea()
                .opacity(model.loaded || model.error != nil ? 0 : 1)
                .animation(.easeOut(duration: 0.45), value: model.loaded)
                .allowsHitTesting(false)

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
                .background(Color(UIColor.systemBackground).ignoresSafeArea())
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

    /// Стили приложения подставляем сами — работают, даже если сайт на сервере ещё старый:
    /// отступы под вырез и Dynamic Island, меню над «домашней» полосой, без полос прокрутки, выделения и подсветки касаний
    private static let appScript = """
    (function () {
      var d = document.documentElement;
      d.classList.add('in-app');
      var css = [
        'html,body{overscroll-behavior:none;touch-action:manipulation}',
        '.app{padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right)}',
        'header.mode-line{padding-top:env(safe-area-inset-top)}',
        'nav.md\\\\:flex{padding-top:env(safe-area-inset-top)}',
        '.in-app,.in-app *{-webkit-tap-highlight-color:transparent;scrollbar-width:none}',
        '.in-app *::-webkit-scrollbar{display:none;width:0;height:0}',
        '.in-app{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;-webkit-text-size-adjust:100%}',
        '.in-app input,.in-app textarea{-webkit-user-select:text;user-select:text}',
        '.map-photo,.map-3d{touch-action:none}'
      ].join('');
      var st = document.createElement('style');
      st.textContent = css;
      d.appendChild(st);
      function fit() {
        var m = document.querySelector('meta[name="viewport"]');
        if (m && m.content.indexOf('viewport-fit') < 0) m.content += ', viewport-fit=cover';
        return !!m;
      }
      if (!fit()) document.addEventListener('DOMContentLoaded', fit);
    })();
    """

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        // метка в User-Agent: сайт понимает, что он внутри приложения, и включает стили приложения и вибрацию
        config.applicationNameForUserAgent = "404App/1.0"
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "theme")
        controller.add(context.coordinator, name: "haptic")
        controller.addUserScript(WKUserScript(source: Self.appScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        controller.addUserScript(WKUserScript(source: Self.themeScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        config.userContentController = controller

        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.uiDelegate = context.coordinator
        view.isOpaque = false
        view.backgroundColor = .clear
        view.allowsLinkPreview = false                       // без превью по долгому нажатию на ссылку
        view.allowsBackForwardNavigationGestures = false
        let scroll = view.scrollView
        scroll.backgroundColor = .clear
        scroll.bounces = false                               // без «резинки» у краёв страницы
        scroll.contentInsetAdjustmentBehavior = .never       // отступы под вырез делает сам сайт (safe-area)
        scroll.keyboardDismissMode = .interactive
        scroll.showsHorizontalScrollIndicator = false
        scroll.showsVerticalScrollIndicator = false
        // масштаб страницы щипком отключён: щипок — только для карты (иначе страница и карта спорят за жест, отсюда лаги)
        scroll.minimumZoomScale = 1
        scroll.maximumZoomScale = 1
        scroll.pinchGestureRecognizer?.isEnabled = false
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
        uiView.configuration.userContentController.removeScriptMessageHandler(forName: "haptic")
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, UIGestureRecognizerDelegate {
        var parent: WebView
        private let light = UIImpactFeedbackGenerator(style: .light)
        private let medium = UIImpactFeedbackGenerator(style: .medium)
        private let notify = UINotificationFeedbackGenerator()

        init(_ parent: WebView) {
            self.parent = parent
            light.prepare()
        }

        // MARK: сообщения от сайта
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            switch message.name {
            case "theme":
                guard let css = message.body as? String, let rgb = Self.parseColor(css) else { return }
                let color = Color(red: rgb.0, green: rgb.1, blue: rgb.2)
                let luminance = 0.2126 * rgb.0 + 0.7152 * rgb.1 + 0.0722 * rgb.2
                DispatchQueue.main.async { self.parent.onTheme(color, luminance < 0.5) }
            case "haptic":
                guard let kind = message.body as? String else { return }
                DispatchQueue.main.async { self.haptic(kind) }
            default:
                break
            }
        }

        /// Тактильный отклик: лёгкий — на нажатия, сильнее и «сигналом» — на тревоги
        private func haptic(_ kind: String) {
            switch kind {
            case "medium": medium.impactOccurred(); medium.prepare()
            case "success": notify.notificationOccurred(.success); notify.prepare()
            case "warning": notify.notificationOccurred(.warning); notify.prepare()
            case "error": notify.notificationOccurred(.error); notify.prepare()
            default: light.impactOccurred(); light.prepare()
            }
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
            DispatchQueue.main.async {
                self.parent.model.error = nil
                self.parent.model.loaded = true
            }
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
