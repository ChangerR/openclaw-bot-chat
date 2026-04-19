import SwiftUI
import Combine
import UserNotifications
import UIKit

@MainActor
final class SettingsViewModel: ObservableObject {
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var isSavingProfile = false
    @Published var isChangingPassword = false
    @Published var loadErrorMessage: String?

    init() {
        self.currentUser = AuthManager.shared.currentUser
    }

    func fetchProfile() async {
        guard !isLoading else { return }

        isLoading = true
        defer { isLoading = false }

        do {
            let user: User = try await APIClient.shared.requestValue("/api/v1/auth/me")
            currentUser = user
            AuthManager.shared.currentUser = user
            loadErrorMessage = nil
        } catch {
            loadErrorMessage = Self.message(from: error)
        }
    }

    func updateProfile(nickname: String, avatarURL: String) async throws -> User {
        isSavingProfile = true
        defer { isSavingProfile = false }

        let payload = UpdateProfileRequest(
            nickname: nickname,
            avatarUrl: avatarURL
        )
        let body = try JSONEncoder().encode(payload)
        let user: User = try await APIClient.shared.requestValue(
            "/api/v1/auth/me",
            method: "PUT",
            body: body
        )

        currentUser = user
        AuthManager.shared.currentUser = user
        loadErrorMessage = nil
        return user
    }

    func changePassword(currentPassword: String, newPassword: String) async throws {
        isChangingPassword = true
        defer { isChangingPassword = false }

        let payload = ChangePasswordRequest(
            oldPassword: currentPassword,
            newPassword: newPassword
        )
        let body = try JSONEncoder().encode(payload)
        let _: APIClient.EmptyResponse = try await APIClient.shared.requestValue(
            "/api/v1/auth/change-password",
            method: "POST",
            body: body
        )
    }

    static func message(from error: Error) -> String {
        if let apiError = error as? APIClient.APIError {
            switch apiError {
            case .invalidURL:
                return "请求地址无效"
            case .noData:
                return "服务器没有返回可用数据"
            case .decodingError:
                return "数据解析失败"
            case .serverError(let message):
                return message
            case .unauthorized:
                return "登录已失效，请重新登录"
            case .networkError(let error):
                return "网络连接失败：\(error.localizedDescription)"
            }
        }

        return error.localizedDescription
    }
}

struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModel()
    @StateObject private var authManager = AuthManager.shared

    @AppStorage("settings.botNotificationsEnabled") private var botNotificationsEnabled = false

    @State private var didInitialLoad = false
    @State private var isEditingProfile = false
    @State private var nicknameDraft = ""
    @State private var avatarURLDraft = ""
    @State private var profileErrorMessage: String?

    @State private var showPasswordEditor = false
    @State private var currentPassword = ""
    @State private var newPassword = ""
    @State private var confirmPassword = ""
    @State private var passwordErrorMessage: String?

    @State private var showDeviceDetails = false
    @State private var notificationAuthorizationStatus: UNAuthorizationStatus = .notDetermined
    @State private var toast: SettingsToastPayload?

    @FocusState private var focusNicknameField: Bool

    private var resolvedUser: User? {
        viewModel.currentUser ?? authManager.currentUser
    }

    private var hasNotificationPermission: Bool {
        notificationAuthorizationStatus == .authorized || notificationAuthorizationStatus == .provisional
    }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                FrostedBackground()

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        if let user = resolvedUser {
                            profileHeader(user: user)
                            
                            sectionHeader(title: "基本信息")
                            basicInfoCard(user: user)
                            
                            sectionHeader(title: "账号安全")
                            securityCard(user: user)
                            
                            sectionHeader(title: "系统偏好")
                            preferencesCard
                            
                            logoutButton
                        } else if viewModel.isLoading {
                            loadingIndicator
                        } else {
                            loadingIndicator
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                    .padding(.bottom, 32)
                }
                .scrollIndicators(.hidden)
                .refreshable {
                    await refreshAll()
                }

                if let toast {
                    toastView(toast)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }
            .navigationTitle("设置")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.light, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .task {
                await initialLoadIfNeeded()
            }
            .onChange(of: resolvedUser?.id) { _, _ in
                syncProfileDraftsIfNeeded()
            }
            .alert(
                "资料加载失败",
                isPresented: Binding(
                    get: { viewModel.loadErrorMessage != nil },
                    set: { _ in viewModel.loadErrorMessage = nil }
                ),
                actions: {
                    Button("知道了", role: .cancel) {}
                },
                message: {
                    Text(viewModel.loadErrorMessage ?? "")
                }
            )
        }
    }

    private var loadingIndicator: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(Color.rcmsAccent)
            Text("正在加载个人资料")
                .font(.subheadline)
                .foregroundStyle(Color.rcmsTextSecondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }

    private func sectionHeader(title: String) -> some View {
        Text(title)
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(Color.rcmsTextSecondary)
            .padding(.leading, 4)
            .padding(.bottom, -8)
    }

    private func profileHeader(user: User) -> some View {
        VStack(spacing: 20) {
            HStack(spacing: 16) {
                ProfileAvatarView(
                    name: isEditingProfile ? effectiveDraftName(for: user) : displayName(for: user),
                    imageURL: isEditingProfile ? normalizedAvatarDraft : avatarURL(for: user),
                    diameter: 80
                )

                VStack(alignment: .leading, spacing: 4) {
                    Text(displayName(for: user))
                        .font(.title2.bold())
                        .foregroundStyle(Color.rcmsTextPrimary)
                    
                    Text("@\(user.username)")
                        .font(.subheadline)
                        .foregroundStyle(Color.rcmsTextSecondary)
                }

                Spacer()

                Button {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                        if isEditingProfile {
                            cancelProfileEditing()
                        } else {
                            startProfileEditing(using: user)
                        }
                    }
                } label: {
                    Text(isEditingProfile ? "取消" : "编辑")
                        .font(.subheadline.bold())
                        .foregroundStyle(isEditingProfile ? Color.rcmsTextSecondary : Color.rcmsAccent)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.white.opacity(0.8))
                        .clipShape(Capsule())
                }
            }

            if isEditingProfile {
                VStack(spacing: 16) {
                    editField(title: "昵称", placeholder: "输入昵称", text: $nicknameDraft)
                        .focused($focusNicknameField)
                    
                    editField(title: "头像地址", placeholder: "HTTPS 链接", text: $avatarURLDraft)

                    if let profileErrorMessage {
                        Text(profileErrorMessage)
                            .font(.caption)
                            .foregroundStyle(Color.rcmsDanger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button {
                        Task { await saveProfileChanges(for: user) }
                    } label: {
                        if viewModel.isSavingProfile {
                            ProgressView().tint(.white)
                        } else {
                            Text("保存修改")
                                .font(.headline)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(Color.rcmsAccent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .disabled(viewModel.isSavingProfile)
                }
                .padding(16)
                .background(Color.white.opacity(0.4))
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .transition(.opacity.combined(with: .scale(scale: 0.95, anchor: .top)))
            }
        }
        .padding(16)
        .glassCardStyle()
    }

    private func editField(title: String, placeholder: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption.bold())
                .foregroundStyle(Color.rcmsTextSecondary)
            
            TextField(placeholder, text: text)
                .textFieldStyle(.plain)
                .padding(12)
                .background(Color.white.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.black.opacity(0.05), lineWidth: 1))
        }
    }

    private func basicInfoCard(user: User) -> some View {
        VStack(spacing: 0) {
            infoRow(title: "邮箱", value: user.email)
            divider
            let uidString = user.id.uuidString.lowercased()
            let shortUID = String(uidString.prefix(8)) + "..."
            infoRow(title: "UID", value: shortUID, isMonospaced: true, copyString: uidString)
            divider
            infoRow(title: "注册时间", value: dateText(user.createdAt) ?? "未知")
        }
        .glassCardStyle()
    }

    private func securityCard(user: User) -> some View {
        VStack(spacing: 0) {
            actionRow(title: "修改密码", subtitle: "定期更换密码以保护账号", value: showPasswordEditor ? "收起" : "前往") {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                    showPasswordEditor.toggle()
                }
            }

            if showPasswordEditor {
                passwordEditor
                    .padding([.horizontal, .bottom], 16)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }

            divider

            actionRow(title: "登录设备", subtitle: "查看当前在线的 iPhone/iPad", value: showDeviceDetails ? "收起" : "查看") {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                    showDeviceDetails.toggle()
                }
            }

            if showDeviceDetails {
                deviceInfo
                    .padding([.horizontal, .bottom], 16)
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .glassCardStyle()
    }

    private var passwordEditor: some View {
        VStack(spacing: 12) {
            SecureField("当前密码", text: $currentPassword)
                .padding(12)
                .background(Color.white.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            
            SecureField("新密码 (至少8位)", text: $newPassword)
                .padding(12)
                .background(Color.white.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 10))
            
            SecureField("确认新密码", text: $confirmPassword)
                .padding(12)
                .background(Color.white.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 10))

            if let passwordErrorMessage {
                Text(passwordErrorMessage)
                    .font(.caption)
                    .foregroundStyle(Color.rcmsDanger)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button {
                Task { await submitPasswordChange() }
            } label: {
                if viewModel.isChangingPassword {
                    ProgressView().tint(.white)
                } else {
                    Text("更新密码").bold()
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
            .background(Color.rcmsAccent)
            .foregroundStyle(.white)
            .clipShape(RoundedRectangle(cornerRadius: 10))
            .disabled(viewModel.isChangingPassword)
        }
        .padding(12)
        .background(Color.black.opacity(0.02))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var deviceInfo: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Image(systemName: UIDevice.current.userInterfaceIdiom == .pad ? "ipad" : "iphone")
                    .font(.title3)
                    .foregroundStyle(Color.rcmsAccent)
                
                VStack(alignment: .leading) {
                    Text(UIDevice.current.name)
                        .font(.subheadline.bold())
                    Text("iOS \(UIDevice.current.systemVersion) · 当前设备")
                        .font(.caption)
                        .foregroundStyle(Color.rcmsTextSecondary)
                }
                Spacer()
                Text("在线").font(.caption.bold()).foregroundStyle(Color.rcmsOnline)
            }
        }
        .padding(12)
        .background(Color.black.opacity(0.02))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private var preferencesCard: some View {
        VStack(spacing: 0) {
            preferenceRow(title: "机器人消息推送", subtitle: notificationSubtitle) {
                Toggle("", isOn: Binding(
                    get: { botNotificationsEnabled },
                    set: { newValue in
                        Task { await updateNotifications(enabled: newValue) }
                    }
                ))
                .labelsHidden()
                .tint(Color.rcmsAccent)
            }
        }
        .glassCardStyle()
    }

    private var logoutButton: some View {
        Button {
            authManager.logout()
        } label: {
            HStack {
                Text("退出登录")
                    .font(.headline)
                    .foregroundStyle(Color.rcmsDanger)
                Spacer()
                Image(systemName: "arrow.right.square")
                    .foregroundStyle(Color.rcmsDanger)
            }
            .padding(18)
            .glassCardStyle()
        }
        .padding(.top, 12)
    }

    private func infoRow(title: String, value: String, isMonospaced: Bool = false, copyString: String? = nil) -> some View {
        HStack {
            Text(title)
                .font(.subheadline)
                .foregroundStyle(Color.rcmsTextSecondary)
            Spacer()
            HStack(spacing: 6) {
                Text(value)
                    .font(.subheadline.weight(.medium))
                    .fontDesign(isMonospaced ? .monospaced : .default)
                    .foregroundStyle(Color.rcmsTextPrimary)
                    .lineLimit(1)
                
                if let copyString {
                    Button {
                        UIPasteboard.general.string = copyString
                        presentToast("已复制到剪贴板")
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.caption)
                            .foregroundStyle(Color.rcmsAccent)
                    }
                }
            }
        }
        .padding(16)
    }

    private func actionRow(title: String, subtitle: String, value: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.subheadline.bold())
                        .foregroundStyle(Color.rcmsTextPrimary)
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.rcmsTextSecondary)
                }
                Spacer()
                Text(value)
                    .font(.caption.bold())
                    .foregroundStyle(Color.rcmsAccent)
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(Color.rcmsTextSecondary.opacity(0.5))
            }
            .padding(16)
        }
        .buttonStyle(.plain)
    }

    private func preferenceRow<Content: View>(title: String, subtitle: String, @ViewBuilder content: () -> Content) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.bold())
                    .foregroundStyle(Color.rcmsTextPrimary)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(Color.rcmsTextSecondary)
            }
            Spacer()
            content()
        }
        .padding(16)
    }

    private var divider: some View {
        Divider().padding(.horizontal, 16).opacity(0.5)
    }

    private func toastView(_ payload: SettingsToastPayload) -> some View {
        HStack(spacing: 8) {
            Image(systemName: payload.isError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                .foregroundStyle(payload.isError ? Color.rcmsDanger : Color.rcmsOnline)
            Text(payload.message)
                .font(.footnote.bold())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.ultraThinMaterial)
        .clipShape(Capsule())
        .shadow(color: .black.opacity(0.1), radius: 10, y: 5)
    }

    private func initialLoadIfNeeded() async {
        guard !didInitialLoad else { return }
        didInitialLoad = true
        syncProfileDraftsIfNeeded()
        await refreshNotificationAuthorization()
        await viewModel.fetchProfile()
        syncProfileDraftsIfNeeded()
    }

    private func refreshAll() async {
        await refreshNotificationAuthorization()
        await viewModel.fetchProfile()
        syncProfileDraftsIfNeeded()
    }

    private func syncProfileDraftsIfNeeded() {
        guard !isEditingProfile, let user = resolvedUser else { return }
        nicknameDraft = displayName(for: user)
        avatarURLDraft = avatarURL(for: user) ?? ""
    }

    private func startProfileEditing(using user: User) {
        nicknameDraft = displayName(for: user)
        avatarURLDraft = avatarURL(for: user) ?? ""
        profileErrorMessage = nil
        isEditingProfile = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
            focusNicknameField = true
        }
    }

    private func cancelProfileEditing() {
        syncProfileDraftsIfNeeded()
        profileErrorMessage = nil
        isEditingProfile = false
    }

    private func saveProfileChanges(for user: User) async {
        let trimmedNickname = nicknameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAvatarURL = avatarURLDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedNickname.isEmpty {
            profileErrorMessage = "昵称不能为空"
            return
        }
        do {
            _ = try await viewModel.updateProfile(nickname: trimmedNickname, avatarURL: trimmedAvatarURL)
            withAnimation { isEditingProfile = false }
            presentToast("个人资料已更新")
        } catch {
            profileErrorMessage = SettingsViewModel.message(from: error)
        }
    }

    private func submitPasswordChange() async {
        passwordErrorMessage = nil
        if newPassword.count < 8 {
            passwordErrorMessage = "新密码至少需要 8 个字符"
            return
        }
        if newPassword != confirmPassword {
            passwordErrorMessage = "两次输入的新密码不一致"
            return
        }
        do {
            try await viewModel.changePassword(currentPassword: currentPassword, newPassword: newPassword)
            resetPasswordForm()
            withAnimation { showPasswordEditor = false }
            presentToast("密码已更新")
        } catch {
            passwordErrorMessage = SettingsViewModel.message(from: error)
        }
    }

    private func resetPasswordForm() {
        currentPassword = ""
        newPassword = ""
        confirmPassword = ""
        passwordErrorMessage = nil
    }

    private func refreshNotificationAuthorization() async {
        let settings = await notificationSettings()
        notificationAuthorizationStatus = settings.authorizationStatus
        if !hasNotificationPermission { botNotificationsEnabled = false }
    }

    private func updateNotifications(enabled: Bool) async {
        if !enabled {
            botNotificationsEnabled = false
            presentToast("已关闭消息提醒")
            return
        }
        if hasNotificationPermission {
            botNotificationsEnabled = true
            presentToast("已开启消息提醒")
            return
        }
        let granted = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
        await refreshNotificationAuthorization()
        if granted == true {
            botNotificationsEnabled = true
            presentToast("已开启消息提醒")
        } else {
            botNotificationsEnabled = false
            presentToast("未获得通知权限", isError: true)
        }
    }

    private func presentToast(_ message: String, isError: Bool = false) {
        let payload = SettingsToastPayload(message: message, isError: isError)
        withAnimation(.spring(response: 0.3)) { toast = payload }
        DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
            if toast?.id == payload.id { withAnimation { toast = nil } }
        }
    }

    private var normalizedAvatarDraft: String? {
        let trimmed = avatarURLDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private func effectiveDraftName(for user: User) -> String {
        let trimmed = nicknameDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? user.username : trimmed
    }

    private func displayName(for user: User) -> String {
        user.nickname?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false ? user.nickname! : user.username
    }

    private func avatarURL(for user: User) -> String? {
        user.avatarUrl?.trimmingCharacters(in: .whitespacesAndNewlines) ?? user.avatar?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func dateText(_ date: Date?) -> String? {
        guard let date else { return nil }
        return Self.dateFormatter.string(from: date)
    }

    private func notificationSettings() async -> UNNotificationSettings {
        await withCheckedContinuation { continuation in
            UNUserNotificationCenter.current().getNotificationSettings { settings in
                continuation.resume(returning: settings)
            }
        }
    }

    private var notificationSubtitle: String {
        switch notificationAuthorizationStatus {
        case .authorized, .provisional: return botNotificationsEnabled ? "推送已开启" : "已授权"
        case .denied: return "系统权限已关闭"
        default: return "未设置"
        }
    }

    private static let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "zh_CN")
        f.dateFormat = "yyyy.MM.dd"
        return f
    }()
}


private struct ProfileAvatarView: View {
    let name: String
    let imageURL: String?
    let diameter: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 224 / 255, green: 242 / 255, blue: 254 / 255),
                            Color(red: 186 / 255, green: 230 / 255, blue: 253 / 255)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            if let imageURL, let url = URL(string: imageURL), !imageURL.isEmpty {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        initials
                    case .empty:
                        ProgressView()
                            .tint(Color.rcmsAccent)
                    @unknown default:
                        initials
                    }
                }
            } else {
                initials
            }
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
        .overlay(
            Circle()
                .stroke(Color.white.opacity(0.96), lineWidth: 3)
        )
        .shadow(color: Color.black.opacity(0.08), radius: 18, x: 0, y: 10)
    }

    private var initials: some View {
        Text(initialsText)
            .font(.system(size: diameter * 0.28, weight: .bold, design: .rounded))
            .foregroundStyle(Color.rcmsAccent)
    }

    private var initialsText: String {
        let pieces = name
            .split(whereSeparator: \.isWhitespace)
            .map { String($0.prefix(1)).uppercased() }

        return String(pieces.joined().prefix(2))
    }
}

private struct SettingsToastPayload: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let isError: Bool
}
