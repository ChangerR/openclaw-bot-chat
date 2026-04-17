import SwiftUI

extension Color {
    static let rcmsAccent = Color(red: 14/255, green: 165/255, blue: 233/255)
    static let rcmsOnline = Color(red: 16/255, green: 185/255, blue: 129/255)
    static let rcmsOffline = Color(red: 148/255, green: 163/255, blue: 184/255)
    static let rcmsDanger = Color(red: 239/255, green: 68/255, blue: 68/255)

    static let rcmsBackground = Color(red: 248/255, green: 250/255, blue: 252/255)
    static let rcmsTextPrimary = Color(red: 30/255, green: 41/255, blue: 59/255)
    static let rcmsTextStrong = Color(red: 15/255, green: 23/255, blue: 42/255)
    static let rcmsTextSecondary = Color(red: 100/255, green: 116/255, blue: 139/255)
    static let rcmsDivider = Color.black.opacity(0.05)
}

struct FrostedBackground: View {
    var body: some View {
        LinearGradient(
            colors: [Color.rcmsBackground, Color(red: 241/255, green: 245/255, blue: 249/255)],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

struct GlassCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color.white.opacity(0.72))
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .stroke(Color.white.opacity(0.9), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 16, x: 0, y: 8)
    }
}

extension View {
    func glassCardStyle() -> some View {
        modifier(GlassCard())
    }
}
