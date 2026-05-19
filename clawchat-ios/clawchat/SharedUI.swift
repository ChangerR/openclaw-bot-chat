import SwiftUI

struct PrimaryButton<Label: View>: View {
    let isLoading: Bool
    let action: () -> Void
    private let label: Label

    @Environment(\.isEnabled) private var isEnabled

    private var canSubmit: Bool {
        isEnabled && !isLoading
    }

    init(
        isLoading: Bool = false,
        action: @escaping () -> Void,
        @ViewBuilder label: () -> Label
    ) {
        self.isLoading = isLoading
        self.action = action
        self.label = label()
    }

    var body: some View {
        Button(action: action) {
            ZStack {
                label
                    .opacity(isLoading ? 0 : 1)

                if isLoading {
                    ProgressView()
                        .tint(.white)
                }
            }
            .font(.headline)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .padding(.horizontal, UITheme.Spacing.medium)
            .foregroundStyle(.white)
            .background(canSubmit ? Color.rcmsAccent : Color.rcmsOffline)
            .clipShape(RoundedRectangle(cornerRadius: UITheme.Radius.medium, style: .continuous))
            .shadow(color: canSubmit ? UITheme.Shadow.accentColor : .clear, radius: 10, x: 0, y: 5)
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
    }
}

struct PrimaryButtonLabel: View {
    let title: String
    let systemImage: String?

    var body: some View {
        HStack(spacing: UITheme.Spacing.tight) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.headline.weight(.semibold))
            }

            Text(title)
                .lineLimit(1)
        }
    }
}

extension PrimaryButton where Label == PrimaryButtonLabel {
    init(
        _ title: String,
        systemImage: String? = nil,
        isLoading: Bool = false,
        action: @escaping () -> Void
    ) {
        self.init(isLoading: isLoading, action: action) {
            PrimaryButtonLabel(title: title, systemImage: systemImage)
        }
    }
}

struct StatusCard<Content: View>: View {
    let title: String
    let message: String?
    let systemImage: String
    let tint: Color
    private let content: Content

    init(
        title: String,
        message: String? = nil,
        systemImage: String = "info.circle.fill",
        tint: Color = .rcmsAccent,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.message = message
        self.systemImage = systemImage
        self.tint = tint
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: UITheme.Spacing.medium) {
            HStack(alignment: .top, spacing: UITheme.Spacing.small) {
                Image(systemName: systemImage)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(width: 28, height: 28)
                    .background(tint.opacity(0.12), in: Circle())

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.rcmsTextStrong)

                    if let message, !message.isEmpty {
                        Text(message)
                            .font(.caption)
                            .foregroundStyle(Color.rcmsTextSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer(minLength: 0)
            }

            content
        }
        .padding(UITheme.Spacing.medium)
        .glassCardStyle()
    }
}

extension StatusCard where Content == EmptyView {
    init(
        title: String,
        message: String? = nil,
        systemImage: String = "info.circle.fill",
        tint: Color = .rcmsAccent
    ) {
        self.init(title: title, message: message, systemImage: systemImage, tint: tint) {
            EmptyView()
        }
    }
}

struct MetricCard: View {
    let title: String
    let value: String
    let caption: String?
    let systemImage: String?
    let tint: Color

    init(
        title: String,
        value: String,
        caption: String? = nil,
        systemImage: String? = nil,
        tint: Color = .rcmsAccent
    ) {
        self.title = title
        self.value = value
        self.caption = caption
        self.systemImage = systemImage
        self.tint = tint
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(tint)
                    .frame(width: 40, height: 40)
                    .background(tint.opacity(0.12), in: Circle())
            }

            Text(value)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(Color.rcmsTextStrong)
                .lineLimit(1)
                .minimumScaleFactor(0.7)

            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(Color.rcmsTextSecondary)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .allowsTightening(true)
                .frame(height: 16, alignment: .topLeading)

            if let caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(Color.rcmsTextSecondary)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 126, alignment: .leading)
        .padding(14)
        .glassCardStyle()
    }
}

struct AvatarBadge: View {
    let name: String
    let imageURL: String?
    let systemImage: String?
    let diameter: CGFloat
    let statusColor: Color?

    init(
        name: String,
        imageURL: String? = nil,
        systemImage: String? = nil,
        diameter: CGFloat = 44,
        statusColor: Color? = nil
    ) {
        self.name = name
        self.imageURL = imageURL
        self.systemImage = systemImage
        self.diameter = diameter
        self.statusColor = statusColor
    }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            avatarBody
                .frame(width: diameter, height: diameter)
                .clipShape(Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.95), lineWidth: 1))

            if let statusColor {
                Circle()
                    .fill(statusColor)
                    .frame(width: max(10, diameter * 0.22), height: max(10, diameter * 0.22))
                    .overlay(Circle().stroke(Color.white, lineWidth: max(2, diameter * 0.045)))
            }
        }
        .frame(width: diameter, height: diameter)
    }

    @ViewBuilder
    private var avatarBody: some View {
        if let imageURL, let url = URL(string: imageURL) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                default:
                    fallbackAvatar
                }
            }
        } else {
            fallbackAvatar
        }
    }

    private var fallbackAvatar: some View {
        ZStack {
            UITheme.avatarGradient

            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: diameter * 0.42, weight: .semibold))
                    .foregroundStyle(Color.rcmsAccent)
            } else {
                Text(initials)
                    .font(.system(size: diameter * 0.34, weight: .bold))
                    .foregroundStyle(Color.rcmsAccent)
            }
        }
    }

    private var initials: String {
        let words = name
            .split(whereSeparator: { $0.isWhitespace || $0 == "-" || $0 == "_" })
            .map(String.init)

        let characters = words.prefix(2).compactMap { $0.first }
        if !characters.isEmpty {
            return characters.map { String($0) }.joined().uppercased()
        }

        return name.first.map { String($0).uppercased() } ?? "?"
    }
}

struct DashboardConversationRow: View {
    let title: String
    let subtitle: String?
    let timestamp: String?
    let unreadCount: Int?
    let avatarURL: String?
    let systemImage: String
    let statusColor: Color?
    let isMuted: Bool

    init(
        title: String,
        subtitle: String? = nil,
        timestamp: String? = nil,
        unreadCount: Int? = nil,
        avatarURL: String? = nil,
        systemImage: String = "person.fill",
        statusColor: Color? = nil,
        isMuted: Bool = false
    ) {
        self.title = title
        self.subtitle = subtitle
        self.timestamp = timestamp
        self.unreadCount = unreadCount
        self.avatarURL = avatarURL
        self.systemImage = systemImage
        self.statusColor = statusColor
        self.isMuted = isMuted
    }

    var body: some View {
        HStack(spacing: UITheme.Spacing.small) {
            AvatarBadge(
                name: title,
                imageURL: avatarURL,
                systemImage: systemImage,
                diameter: 52,
                statusColor: statusColor
            )

            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: UITheme.Spacing.tight) {
                    Text(title)
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(Color.rcmsTextStrong)
                        .lineLimit(1)

                    Spacer(minLength: 8)

                    if let timestamp, !timestamp.isEmpty {
                        Text(timestamp)
                            .font(.caption2)
                            .foregroundStyle(Color.rcmsTextSecondary)
                    }
                }

                HStack(spacing: UITheme.Spacing.tight) {
                    if let subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(Color.rcmsTextSecondary)
                            .lineLimit(1)
                    }

                    Spacer(minLength: 8)

                    if isMuted {
                        Image(systemName: "bell.slash.fill")
                            .font(.caption2)
                            .foregroundStyle(Color.rcmsTextSecondary)
                    }

                    if let unreadCount, unreadCount > 0 {
                        Text(unreadText(for: unreadCount))
                            .font(.caption2.bold())
                            .foregroundStyle(.white)
                            .frame(minWidth: 20, minHeight: 20)
                            .padding(.horizontal, unreadCount > 9 ? 6 : 0)
                            .background(Color.rcmsDanger, in: Capsule())
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, minHeight: 74, alignment: .leading)
        .padding(.horizontal, 4)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
    }

    private func unreadText(for count: Int) -> String {
        count > 99 ? "99+" : String(count)
    }
}

struct SettingsSection<Content: View>: View {
    let title: String?
    let footer: String?
    private let content: Content

    init(
        _ title: String? = nil,
        footer: String? = nil,
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.footer = footer
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title, !title.isEmpty {
                Text(title)
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(Color.rcmsTextSecondary)
                    .padding(.leading, 4)
            }

            VStack(spacing: 0) {
                content
            }
            .glassCardStyle()

            if let footer, !footer.isEmpty {
                Text(footer)
                    .font(.caption)
                    .foregroundStyle(Color.rcmsTextSecondary)
                    .padding(.horizontal, 4)
            }
        }
    }
}

struct SettingsRow<Accessory: View>: View {
    let title: String
    let subtitle: String?
    let systemImage: String?
    let iconTint: Color
    let value: String?
    let showsChevron: Bool
    let action: (() -> Void)?
    private let accessory: Accessory

    init(
        title: String,
        subtitle: String? = nil,
        systemImage: String? = nil,
        iconTint: Color = .rcmsAccent,
        value: String? = nil,
        showsChevron: Bool = false,
        action: (() -> Void)? = nil,
        @ViewBuilder accessory: () -> Accessory
    ) {
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.iconTint = iconTint
        self.value = value
        self.showsChevron = showsChevron
        self.action = action
        self.accessory = accessory()
    }

    var body: some View {
        Group {
            if let action {
                Button(action: action) {
                    rowContent
                }
                .buttonStyle(.plain)
            } else {
                rowContent
            }
        }
    }

    private var rowContent: some View {
        HStack(spacing: UITheme.Spacing.small) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(iconTint)
                    .frame(width: 30, height: 30)
                    .background(iconTint.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.rcmsTextPrimary)
                    .lineLimit(1)

                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.rcmsTextSecondary)
                        .lineLimit(2)
                }
            }

            Spacer(minLength: 8)

            if let value, !value.isEmpty {
                Text(value)
                    .font(.caption.bold())
                    .foregroundStyle(Color.rcmsAccent)
                    .lineLimit(1)
            }

            accessory

            if showsChevron {
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(Color.rcmsTextSecondary.opacity(0.5))
            }
        }
        .padding(UITheme.Spacing.medium)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

extension SettingsRow where Accessory == EmptyView {
    init(
        title: String,
        subtitle: String? = nil,
        systemImage: String? = nil,
        iconTint: Color = .rcmsAccent,
        value: String? = nil,
        showsChevron: Bool = false,
        action: (() -> Void)? = nil
    ) {
        self.init(
            title: title,
            subtitle: subtitle,
            systemImage: systemImage,
            iconTint: iconTint,
            value: value,
            showsChevron: showsChevron,
            action: action
        ) {
            EmptyView()
        }
    }
}
