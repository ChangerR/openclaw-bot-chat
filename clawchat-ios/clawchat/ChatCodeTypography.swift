import SwiftUI
import UIKit
import MarkdownUI

enum ChatCodeTypography {
    private static let regularFontCandidates = [
        "FiraCode-Regular",
        "Fira Code Regular",
        "SFMono-Regular",
        "Menlo-Regular",
        "Monaco"
    ]

    private static let semiboldFontCandidates = [
        "FiraCode-SemiBold",
        "Fira Code SemiBold",
        "SFMono-Semibold",
        "Menlo-Bold",
        "Monaco"
    ]

    private static let markdownFontCandidates = [
        "FiraCode-Regular",
        "Fira Code Regular",
        "SFMono-Regular",
        "Menlo-Regular",
        "Monaco"
    ]

    static func codeFont(size: CGFloat = 14) -> Font {
        resolvedFont(size: size, candidates: regularFontCandidates, fallbackWeight: .regular)
    }

    static func labelFont(size: CGFloat = 11) -> Font {
        resolvedFont(size: size, candidates: semiboldFontCandidates, fallbackWeight: .semibold)
    }

    static var markdownFontFamily: FontProperties.Family {
        for name in markdownFontCandidates where UIFont(name: name, size: 14) != nil {
            return .custom(name)
        }

        return .system(.monospaced)
    }

    private static func resolvedFont(size: CGFloat, candidates: [String], fallbackWeight: Font.Weight) -> Font {
        for name in candidates where UIFont(name: name, size: size) != nil {
            return .custom(name, size: size)
        }

        return .system(size: size, weight: fallbackWeight, design: .monospaced)
    }
}
