import SwiftUI

extension Color {
    static let rcmsSurface = Color.white.opacity(0.78)
    static let rcmsSurfaceSolid = Color.white
    static let rcmsSurfaceMuted = Color(red: 241/255, green: 245/255, blue: 249/255)
    static let rcmsAccentSoft = Color(red: 224/255, green: 242/255, blue: 254/255)
    static let rcmsAccentSofter = Color(red: 186/255, green: 230/255, blue: 253/255)
    static let rcmsWarning = Color(red: 245/255, green: 158/255, blue: 11/255)

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

enum UITheme {
    enum Radius {
        static let small: CGFloat = 8
        static let medium: CGFloat = 12
        static let large: CGFloat = 16
        static let pill: CGFloat = 999
    }

    enum Spacing {
        static let tight: CGFloat = 6
        static let small: CGFloat = 10
        static let medium: CGFloat = 16
        static let large: CGFloat = 20
    }

    enum Shadow {
        static let cardColor = Color.black.opacity(0.08)
        static let cardRadius: CGFloat = 16
        static let cardYOffset: CGFloat = 8
        static let accentColor = Color.rcmsAccent.opacity(0.3)
    }

    static let cardStroke = Color.white.opacity(0.9)
    static let subtleStroke = Color.black.opacity(0.05)

    static var avatarGradient: LinearGradient {
        LinearGradient(
            colors: [Color.rcmsAccentSoft, Color.rcmsAccentSofter],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

struct FrostedBackground: View {
    var body: some View {
        LinearGradient(
            colors: [Color.rcmsBackground, Color.rcmsSurfaceMuted],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

struct GlassCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(Color.rcmsSurface)
            .background(.ultraThinMaterial)
            .clipShape(RoundedRectangle(cornerRadius: UITheme.Radius.large, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: UITheme.Radius.large, style: .continuous)
                    .stroke(UITheme.cardStroke, lineWidth: 1)
            )
            .shadow(color: UITheme.Shadow.cardColor, radius: UITheme.Shadow.cardRadius, x: 0, y: UITheme.Shadow.cardYOffset)
    }
}

extension View {
    func glassCardStyle() -> some View {
        modifier(GlassCard())
    }
}
