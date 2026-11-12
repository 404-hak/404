import SwiftUI

/// Экран адреса сервера: первый запуск, если адрес не вшит в сборку, и смена адреса.
struct SetupView: View {
    let initial: String
    let canCancel: Bool
    let onSave: (String) -> Void
    let onCancel: () -> Void

    @State private var text: String
    @FocusState private var focused: Bool

    init(initial: String, canCancel: Bool, onSave: @escaping (String) -> Void, onCancel: @escaping () -> Void) {
        self.initial = initial
        self.canCancel = canCancel
        self.onSave = onSave
        self.onCancel = onCancel
        _text = State(initialValue: initial)
    }

    private var valid: Bool { Server.normalize(text) != nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Spacer()
            Text("404")
                .font(.system(size: 44, weight: .bold, design: .rounded))
            Text("Адрес сервера дашборда")
                .font(.headline)
            Text("Например, адрес порта 8000 из Codespaces (…app.github.dev) или адрес компьютера в вашей сети, как 192.168.1.5:8000.")
                .font(.footnote)
                .foregroundColor(.secondary)
            TextField("https://…", text: $text)
                .textInputAutocapitalization(.never)
                .disableAutocorrection(true)
                .keyboardType(.URL)
                .focused($focused)
                .submitLabel(.go)
                .onSubmit(save)
                .padding(12)
                .background(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.5)))
            Button(action: save) {
                Text("Подключиться")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .disabled(!valid)
            if canCancel {
                Button("Отмена", action: onCancel)
                    .frame(maxWidth: .infinity)
            }
            Spacer()
            Spacer()
        }
        .padding(24)
        .frame(maxWidth: 520)
        .onAppear { focused = initial.isEmpty }
    }

    private func save() {
        guard let url = Server.normalize(text) else { return }
        onSave(url.absoluteString)
    }
}
