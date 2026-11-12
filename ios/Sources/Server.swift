import Foundation

/// Адрес сервера 404: то, что ввёл пользователь, или адрес, вшитый при сборке (Info.plist → ServerURL).
enum Server {
    static let storageKey = "serverURL"

    /// Адрес по умолчанию из сборки; пусто, если при сборке его не задали
    static var bundled: String {
        let raw = (Bundle.main.object(forInfoDictionaryKey: "ServerURL") as? String) ?? ""
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return s.hasPrefix("$(") ? "" : s
    }

    /// Приводит ввод к адресу: «name-8000.app.github.dev» → https://…, «192.168.1.5:8000» → http://…
    static func normalize(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty else { return nil }
        if !s.contains("://") {
            let hostPart = s.split(separator: "/").first.map(String.init) ?? s
            let bare = hostPart.split(separator: ":").first.map(String.init) ?? hostPart
            let isIP = bare.range(of: #"^\d{1,3}(\.\d{1,3}){3}$"#, options: .regularExpression) != nil
            let isLocal = isIP || bare == "localhost" || bare.hasSuffix(".local")
            s = (isLocal ? "http://" : "https://") + s
        }
        guard let url = URL(string: s), let host = url.host, !host.isEmpty,
              url.scheme == "http" || url.scheme == "https" else { return nil }
        return url
    }
}
