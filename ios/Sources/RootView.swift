import SwiftUI

struct RootView: View {
    @AppStorage(Server.storageKey) private var saved: String = ""
    @State private var background = Color(red: 11 / 255, green: 22 / 255, blue: 40 / 255)
    @State private var dark = true
    @State private var changing = false

    private var address: String { saved.isEmpty ? Server.bundled : saved }
    private var url: URL? { Server.normalize(address) }

    var body: some View {
        ZStack {
            background.ignoresSafeArea()
            if let url, !changing {
                WebScreen(url: url, background: background, onTheme: { color, isDark in
                    background = color
                    dark = isDark
                }, onChangeServer: { changing = true })
                .id(url)
            } else {
                SetupView(initial: address, canCancel: url != nil, onSave: { value in
                    saved = value
                    changing = false
                }, onCancel: { changing = false })
            }
        }
        // цвет системных элементов (часы, батарея) следует теме сайта: ночью светлые, днём тёмные
        .preferredColorScheme(dark ? .dark : .light)
    }
}
