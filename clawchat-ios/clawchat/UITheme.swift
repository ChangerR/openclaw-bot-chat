import SwiftUI

extension Color {
    static let rcmsAccent = Color(red: 14/255, green: 165/255, blue: 233/255)
    static let rcmsOnline = Color(red: 16/255, green: 185/255, blue: 129/255)
    static let rcmsOffline = Color(red: 148/255, green: 163/255, blue: 184/255)
    static let rcmsDanger = Color(red: 239/255, green: 68/255, blue: 68/255)
}

struct FrostedBackground: View {
    var body: some View {
        LinearGradient(
            colors: [Color(red: 0.95, green: 0.97, blue: 1.0), Color.white],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .ignoresSafeArea()
    }
}

struct FrostedCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.18))
            )
            .shadow(color: Color.black.opacity(0.08), radius: 12, x: 0, y: 8)
    }
}

extension View {
    func frostedCardStyle() -> some View {
        modifier(FrostedCard())
    }
}
