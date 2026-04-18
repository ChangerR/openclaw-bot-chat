import SwiftUI
import HighlightSwift

struct ChatHighlightedCodeView: View {
    let code: String
    let language: String?
    let isMe: Bool

    @State private var highlightedText: AttributedString?

    private let highlighter = Highlight()

    var body: some View {
        Group {
            if let highlightedText {
                Text(highlightedText)
            } else {
                Text(verbatim: code)
                    .foregroundStyle(isMe ? Color.white.opacity(0.92) : Color.rcmsTextStrong)
            }
        }
        .font(ChatCodeTypography.codeFont())
        .textSelection(.enabled)
        .task(id: renderKey) {
            await renderHighlightedText()
        }
    }

    private var renderKey: String {
        "\(normalizedLanguage ?? "auto")::\(isMe ? "sent" : "received")::\(code)"
    }

    private var normalizedLanguage: String? {
        let trimmed = language?.trimmingCharacters(in: .whitespacesAndNewlines)
        return (trimmed?.isEmpty == false) ? trimmed : nil
    }

    @MainActor
    private func renderHighlightedText() async {
        do {
            let colors = HighlightColors.custom(css: isMe ? Self.sentCodeCSS : Self.receivedCodeCSS)

            if let normalizedLanguage {
                highlightedText = try await highlighter.attributedText(
                    code,
                    language: normalizedLanguage,
                    colors: colors
                )
            } else {
                highlightedText = try await highlighter.attributedText(
                    code,
                    colors: colors
                )
            }
        } catch {
            highlightedText = nil
        }
    }

    private static let sentCodeCSS = """
    .hljs { color: #f8fafc; }
    .hljs-comment, .hljs-quote { color: #94a3b8; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #fde047; }
    .hljs-string, .hljs-doctag, .hljs-regexp { color: #86efac; }
    .hljs-number, .hljs-symbol, .hljs-bullet { color: #c4b5fd; }
    .hljs-title, .hljs-section, .hljs-function .hljs-title { color: #7dd3fc; }
    .hljs-type, .hljs-class .hljs-title, .hljs-built_in { color: #fda4af; }
    .hljs-meta, .hljs-meta .hljs-keyword, .hljs-selector-id { color: #fdba74; }
    .hljs-attr, .hljs-attribute, .hljs-property { color: #67e8f9; }
    """

    private static let receivedCodeCSS = """
    .hljs { color: #0f172a; }
    .hljs-comment, .hljs-quote { color: #64748b; }
    .hljs-keyword, .hljs-selector-tag, .hljs-literal { color: #7c3aed; }
    .hljs-string, .hljs-doctag, .hljs-regexp { color: #16a34a; }
    .hljs-number, .hljs-symbol, .hljs-bullet { color: #ea580c; }
    .hljs-title, .hljs-section, .hljs-function .hljs-title { color: #2563eb; }
    .hljs-type, .hljs-class .hljs-title, .hljs-built_in { color: #0891b2; }
    .hljs-meta, .hljs-meta .hljs-keyword, .hljs-selector-id { color: #dc2626; }
    .hljs-attr, .hljs-attribute, .hljs-property { color: #0f766e; }
    """
}
