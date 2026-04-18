import SwiftUI
import Combine
import MarkdownUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit

struct ChatContext {
    let id: String
    let title: String
    let subtitle: String
    let isGroup: Bool
    let groupId: String?
}

class ChatRoomViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var inputText = ""
    @Published var isLoading = false
    @Published var isLoadingOlder = false
    @Published var hasMoreHistory = true
    @Published var errorMessage: String?
    @Published var isUploadingImage = false
    @Published var connectionState: RealtimeConnectionState = .idle

    let conversationId: String

    private let pageSize = 50
    private var cancellables = Set<AnyCancellable>()
    private var syncTask: Task<Void, Never>?

    init(conversationId: String) {
        self.conversationId = conversationId

        RealtimeService.shared.$connectionState
            .receive(on: DispatchQueue.main)
            .assign(to: &$connectionState)

        RealtimeService.shared.messagePublisher
            .filter { $0.conversationId == self.conversationId }
            .receive(on: DispatchQueue.main)
            .sink { [weak self] message in
                self?.handleIncomingMessage(message)
            }
            .store(in: &cancellables)
    }

    deinit {
        syncTask?.cancel()
    }

    func fetchMessages() {
        errorMessage = nil
        messages = sortMessages(LocalMessageStore.shared.recentMessages(conversationId: conversationId, limit: pageSize))
        updateHistoryAvailability()
        isLoading = messages.isEmpty

        syncTask?.cancel()
        syncTask = Task { [weak self] in
            await self?.refreshLatestMessages()
        }
    }

    @MainActor
    func loadOlderMessages() async {
        guard !isLoadingOlder else { return }
        guard let beforeSequence = messages.first?.seq, beforeSequence > 1 else {
            hasMoreHistory = false
            return
        }

        isLoadingOlder = true
        defer { isLoadingOlder = false }

        let localOlderMessages = LocalMessageStore.shared.messagesBefore(
            conversationId: conversationId,
            beforeSequence: beforeSequence,
            limit: pageSize
        )
        if !localOlderMessages.isEmpty {
            messages = mergeMessages(messages, with: localOlderMessages)
        }

        guard localOlderMessages.count < pageSize else {
            updateHistoryAvailability()
            return
        }

        do {
            let remoteOlderMessages = try await fetchRemoteMessages(limit: pageSize, beforeSeq: beforeSequence)
            if !remoteOlderMessages.isEmpty {
                LocalMessageStore.shared.upsert(messages: remoteOlderMessages)
                messages = mergeMessages(messages, with: remoteOlderMessages)
            }
        } catch {
            errorMessage = error.localizedDescription
        }

        updateHistoryAvailability()
    }

    private func handleIncomingMessage(_ message: Message) {
        messages = mergeMessages(messages, with: [message])
    }

    @MainActor
    private func refreshLatestMessages() async {
        defer { isLoading = false }

        do {
            var remoteMessages: [Message] = []
            if let lastSequence = LocalMessageStore.shared.highestSequence(conversationId: conversationId), lastSequence > 0 {
                let catchupMessages = try await fetchRemoteMessages(
                    limit: RealtimeService.shared.historyMaxCatchupBatch,
                    afterSeq: lastSequence
                )
                remoteMessages.append(contentsOf: catchupMessages)
            }

            if messages.isEmpty || messages.count < pageSize {
                let latestMessages = try await fetchRemoteMessages(limit: pageSize)
                remoteMessages.append(contentsOf: latestMessages)
            }

            if !remoteMessages.isEmpty {
                LocalMessageStore.shared.upsert(messages: remoteMessages)
                messages = mergeMessages(messages, with: remoteMessages)
            }

            updateHistoryAvailability()
        } catch {
            updateHistoryAvailability()
            if messages.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }

    private func fetchRemoteMessages(limit: Int, beforeSeq: Int? = nil, afterSeq: Int? = nil) async throws -> [Message] {
        let endpoint = messageEndpoint(limit: limit, beforeSeq: beforeSeq, afterSeq: afterSeq)

        return try await withCheckedThrowingContinuation { continuation in
            var cancellable: AnyCancellable?
            cancellable = APIClient.shared.request(endpoint)
                .receive(on: DispatchQueue.main)
                .sink { completion in
                    switch completion {
                    case .finished:
                        break
                    case .failure(let error):
                        continuation.resume(throwing: error)
                    }
                    cancellable?.cancel()
                    cancellable = nil
                } receiveValue: { (messages: [Message]) in
                    continuation.resume(returning: self.sortMessages(messages))
                    cancellable?.cancel()
                    cancellable = nil
                }
        }
    }

    private func messageEndpoint(limit: Int, beforeSeq: Int? = nil, afterSeq: Int? = nil) -> String {
        var endpoint = "/api/v1/messages/\(conversationId)?limit=\(max(1, min(limit, 200)))"
        if let beforeSeq {
            endpoint += "&before_seq=\(beforeSeq)"
        }
        if let afterSeq {
            endpoint += "&after_seq=\(afterSeq)"
        }
        return endpoint
    }

    private func mergeMessages(_ existing: [Message], with incoming: [Message]) -> [Message] {
        let merged = (existing + incoming).reduce(into: [String: Message]()) { result, message in
            result[message.id] = message
        }
        return sortMessages(Array(merged.values))
    }

    private func sortMessages(_ items: [Message]) -> [Message] {
        items.sorted { lhs, rhs in
            let leftCreatedAt = lhs.createdAt?.timeIntervalSince1970 ?? 0
            let rightCreatedAt = rhs.createdAt?.timeIntervalSince1970 ?? 0
            if leftCreatedAt != rightCreatedAt {
                return leftCreatedAt < rightCreatedAt
            }

            let leftTimestamp = lhs.timestamp ?? 0
            let rightTimestamp = rhs.timestamp ?? 0
            if leftTimestamp != rightTimestamp {
                return leftTimestamp < rightTimestamp
            }

            if lhs.topic == rhs.topic,
               let leftSeq = lhs.seq,
               let rightSeq = rhs.seq,
               leftSeq != rightSeq {
                return leftSeq < rightSeq
            }

            return lhs.id < rhs.id
        }
    }

    private func updateHistoryAvailability() {
        if let earliestSequence = messages.first?.seq {
            hasMoreHistory = earliestSequence > 1
        } else {
            hasMoreHistory = false
        }
    }

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }

        let didSend = RealtimeService.shared.sendMessage(conversationId: conversationId, text: text, topic: conversationId)
        guard didSend else {
            errorMessage = "消息发送失败，请检查连接状态后重试。"
            return
        }

        inputText = ""
    }

    @MainActor
    func sendImage(item: PhotosPickerItem) async {
        guard !isUploadingImage else { return }
        guard connectionState == .connected else {
            errorMessage = "当前连接不可用，暂时无法发送图片。"
            return
        }

        isUploadingImage = true
        defer { isUploadingImage = false }

        do {
            let preparedImage = try await normalizedUploadImage(from: item)
            let preparedUpload = try await APIClient.shared.prepareImageUpload(
                fileName: preparedImage.fileName,
                contentType: preparedImage.mimeType,
                size: preparedImage.data.count,
                conversationID: conversationId
            )

            try await APIClient.shared.uploadImageData(preparedImage.data, with: preparedUpload.upload)

            let assetID = preparedUpload.asset.id ?? ""
            let objectKey = preparedUpload.asset.objectKey ?? ""
            guard !assetID.isEmpty, !objectKey.isEmpty else {
                throw ChatImageError.invalidUploadResponse
            }

            let asset = try await APIClient.shared.completeImageUpload(assetID: assetID, objectKey: objectKey)
            let caption = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
            let outgoingContent = RealtimeContentPayload(
                type: "image",
                body: caption.isEmpty ? (asset.fileName ?? preparedImage.fileName) : caption,
                url: asset.preferredImageURLString,
                name: asset.fileName,
                size: asset.size,
                meta: ["asset": asset.metaValue]
            )

            let didSend = RealtimeService.shared.sendMessage(
                conversationId: conversationId,
                content: outgoingContent,
                topic: conversationId
            )
            guard didSend else {
                throw ChatImageError.messageSendFailed
            }

            inputText = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func normalizedUploadImage(from item: PhotosPickerItem) async throws -> UploadImagePayload {
        guard let rawData = try await item.loadTransferable(type: Data.self), !rawData.isEmpty else {
            throw ChatImageError.unreadableImage
        }

        let preferredType = item.supportedContentTypes.first(where: { $0.conforms(to: .image) })
        let preferredMimeType = preferredType?.preferredMIMEType?.lowercased()

        if let preferredMimeType, Self.supportedImageMimeTypes.contains(preferredMimeType) {
            let fileExtension = preferredType?.preferredFilenameExtension ?? fileExtension(for: preferredMimeType)
            return UploadImagePayload(
                data: rawData,
                fileName: "image-\(UUID().uuidString.lowercased()).\(fileExtension)",
                mimeType: preferredMimeType
            )
        }

        guard let image = UIImage(data: rawData), let jpegData = image.jpegData(compressionQuality: 0.9) else {
            throw ChatImageError.unsupportedImage
        }

        return UploadImagePayload(
            data: jpegData,
            fileName: "image-\(UUID().uuidString.lowercased()).jpg",
            mimeType: "image/jpeg"
        )
    }

    private func fileExtension(for mimeType: String) -> String {
        switch mimeType {
        case "image/png":
            return "png"
        case "image/webp":
            return "webp"
        case "image/gif":
            return "gif"
        default:
            return "jpg"
        }
    }

    private static let supportedImageMimeTypes: Set<String> = [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif",
    ]
}

private struct UploadImagePayload {
    let data: Data
    let fileName: String
    let mimeType: String
}

private enum ChatImageError: LocalizedError {
    case unreadableImage
    case unsupportedImage
    case invalidUploadResponse
    case messageSendFailed

    var errorDescription: String? {
        switch self {
        case .unreadableImage:
            return "无法读取所选图片，请换一张后重试。"
        case .unsupportedImage:
            return "当前图片格式暂不支持，且转换失败。"
        case .invalidUploadResponse:
            return "图片上传响应不完整，请稍后重试。"
        case .messageSendFailed:
            return "图片已上传，但消息发送失败，请重试。"
        }
    }
}

class GroupMaintenanceViewModel: ObservableObject {
    @Published var members: [GroupUserMember] = []
    @Published var botMembers: [GroupBotMember] = []
    @Published var allBots: [Bot] = []
    @Published var groupName = ""
    @Published var searchText = ""
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    func bootstrap(groupId: String, currentName: String) {
        groupName = currentName
        loadMembers(groupId: groupId)
        loadBots()
    }

    func loadMembers(groupId: String) {
        APIClient.shared.request("/api/v1/groups/\(groupId)/members")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (payload: GroupMembersPayload) in
                self.members = payload.users
                self.botMembers = payload.bots
            }
            .store(in: &cancellables)
    }

    func loadBots() {
        APIClient.shared.request("/api/v1/bots")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (bots: [Bot]) in
                self.allBots = bots
            }
            .store(in: &cancellables)
    }

    func renameGroup(groupId: String) {
        let payload: [String: String] = ["name": groupName]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }

        APIClient.shared.request("/api/v1/groups/\(groupId)", method: "PUT", body: body)
            .sink { _ in } receiveValue: { (_: ChatGroup) in }
            .store(in: &cancellables)
    }

    func removeMember(groupId: String, memberId: UUID) {
        APIClient.shared.request("/api/v1/groups/\(groupId)/members/\(memberId.uuidString)", method: "DELETE")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (_: [String: String]) in
                self.loadMembers(groupId: groupId)
            }
            .store(in: &cancellables)
    }

    func addBot(groupId: String, botId: UUID) {
        let payload: [String: String] = ["bot_id": botId.uuidString]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else { return }

        APIClient.shared.request("/api/v1/groups/\(groupId)/members", method: "POST", body: body)
            .receive(on: DispatchQueue.main)
            .sink { completion in
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (_: [String: String]) in
                self.loadMembers(groupId: groupId)
            }
            .store(in: &cancellables)
    }

    var filteredBots: [Bot] {
        let term = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if term.isEmpty { return allBots }
        return allBots.filter { $0.name.localizedCaseInsensitiveContains(term) }
    }
}

struct ChatRoomView: View {
    let context: ChatContext
    @StateObject private var viewModel: ChatRoomViewModel
    @StateObject private var groupVM = GroupMaintenanceViewModel()
    @ObservedObject private var authManager = AuthManager.shared
    @State private var showGroupSheet = false
    @State private var selectedPhotoItem: PhotosPickerItem?
    private let bottomAnchorID = "chat-room-bottom-anchor"

    init(context: ChatContext) {
        self.context = context
        _viewModel = StateObject(wrappedValue: ChatRoomViewModel(conversationId: context.id))
    }

    init(conversationId: String, title: String) {
        let context = ChatContext(id: conversationId, title: title, subtitle: "", isGroup: false, groupId: nil)
        self.init(context: context)
    }

    var body: some View {
        ZStack {
            FrostedBackground()

            VStack(spacing: 0) {
                if viewModel.connectionState != .connected {
                    Text(viewModel.connectionState == .connecting ? "连接中..." : "已断开")
                        .font(.caption)
                        .foregroundStyle(Color.rcmsTextSecondary)
                        .padding(.vertical, 4)
                }

                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(spacing: 10) {
                            ForEach(viewModel.messages) { message in
                                ChatBubbleRow(
                                    message: message,
                                    currentUserID: authManager.currentUser?.id.uuidString,
                                    showsSenderInfo: context.isGroup
                                )
                                    .id(message.id)
                            }

                            Color.clear
                                .frame(height: 1)
                                .id(bottomAnchorID)
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 8)
                        .padding(.bottom, 16)
                    }
                    .refreshable {
                        await viewModel.loadOlderMessages()
                    }
                    .onAppear {
                        scrollToBottom(with: proxy, animated: false)
                    }
                    .onChange(of: viewModel.messages.map(\.id)) {
                        scrollToBottom(with: proxy)
                    }
                }

                inputBar
            }
        }
        .navigationTitle(context.title)
        .navigationBarTitleDisplayMode(.large)
        .toolbar(.hidden, for: .tabBar)
        .toolbar {
            if context.isGroup {
                Button {
                    showGroupSheet = true
                    if let groupId = context.groupId {
                        groupVM.bootstrap(groupId: groupId, currentName: context.title)
                    }
                } label: {
                    Image(systemName: "gearshape.fill")
                }
            }
        }
                .onAppear {
            RealtimeService.shared.setActiveConversation(context.id)
            viewModel.fetchMessages()
        }
        .onDisappear {
            RealtimeService.shared.setActiveConversation(nil)
        }
        .sheet(isPresented: $showGroupSheet) {
            if let groupId = context.groupId {
                GroupMaintenanceSheet(viewModel: groupVM, groupId: groupId)
                    .presentationDetents([.fraction(0.65)])
            }
        }
        .onChange(of: selectedPhotoItem) {
            guard let selectedPhotoItem else { return }
            Task {
                await viewModel.sendImage(item: selectedPhotoItem)
                await MainActor.run {
                    self.selectedPhotoItem = nil
                }
            }
        }
        .alert(
            "提示",
            isPresented: Binding(
                get: { viewModel.errorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        viewModel.errorMessage = nil
                    }
                }
            )
        ) {
            Button("确定", role: .cancel) {
                viewModel.errorMessage = nil
            }
        } message: {
            Text(viewModel.errorMessage ?? "")
        }
    }

    private var inputBar: some View {
        HStack(spacing: 10) {
            PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
                ZStack {
                    Circle()
                        .fill(Color.white.opacity(0.82))
                        .frame(width: 42, height: 42)

                    if viewModel.isUploadingImage {
                        ProgressView()
                            .tint(Color.rcmsAccent)
                    } else {
                        Image(systemName: "photo.on.rectangle.angled")
                            .foregroundStyle(Color.rcmsAccent)
                    }
                }
            }
            .disabled(viewModel.connectionState != .connected || viewModel.isUploadingImage)

            TextField("发送消息", text: $viewModel.inputText, axis: .vertical)
                .padding(11)
                .background(Color.white.opacity(0.82))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .foregroundStyle(Color.rcmsTextPrimary)
                .disabled(viewModel.connectionState != .connected || viewModel.isUploadingImage)

            Button(action: viewModel.sendMessage) {
                Image(systemName: "paperplane.fill")
                    .foregroundStyle(.white)
                    .frame(width: 42, height: 42)
                    .background(Circle().fill(Color.rcmsAccent))
            }
            .disabled(
                viewModel.inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    || viewModel.connectionState != .connected
                    || viewModel.isUploadingImage
            )
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 10)
        .background(Color.white.opacity(0.72))
        .background(.ultraThinMaterial)
    }

    private func scrollToBottom(with proxy: ScrollViewProxy, animated: Bool = true) {
        let scroll = {
            proxy.scrollTo(bottomAnchorID, anchor: .bottom)
        }

        DispatchQueue.main.async {
            if animated {
                withAnimation(.easeOut(duration: 0.2)) {
                    scroll()
                }
            } else {
                scroll()
            }
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            scroll()
        }
    }
}

struct MessageMarkdownView: View {
    let text: String
    let isMe: Bool

    var body: some View {
        Markdown(text)
            .markdownTheme(.rcmsChatTheme(isMe: isMe))
            .tint(isMe ? .white : .rcmsAccent)
    }
}

extension Theme {
    static func rcmsChatTheme(isMe: Bool) -> Theme {
        Theme()
            .text {
                ForegroundColor(isMe ? .white : Color.rcmsTextPrimary)
                FontSize(15)
            }
            .code {
                FontFamily(ChatCodeTypography.markdownFontFamily)
                FontSize(14)
                BackgroundColor(isMe ? Color.white.opacity(0.15) : Color.gray.opacity(0.1))
            }
            .codeBlock { configuration in
                VStack(alignment: .leading, spacing: 0) {
                    if let language = configuration.language?.trimmingCharacters(in: .whitespacesAndNewlines), !language.isEmpty {
                        Text(language.uppercased())
                            .font(ChatCodeTypography.labelFont())
                            .foregroundStyle(isMe ? Color.white.opacity(0.7) : Color.rcmsTextSecondary)
                            .padding(.horizontal, 10)
                            .padding(.top, 8)
                    }

                    ScrollView(.horizontal, showsIndicators: false) {
                        ChatHighlightedCodeView(
                            code: configuration.content,
                            language: configuration.language,
                            isMe: isMe
                        )
                            .fixedSize(horizontal: true, vertical: false)
                            .lineSpacing(3)
                            .padding(.horizontal, 10)
                            .padding(.top, configuration.language == nil ? 10 : 6)
                            .padding(.bottom, 10)
                    }
                }
                .background(isMe ? Color.black.opacity(0.2) : Color(red: 248/255, green: 250/255, blue: 252/255))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .markdownMargin(top: 8, bottom: 8)
            }
            .link {
                ForegroundColor(isMe ? .white : Color.rcmsAccent)
            }
            .paragraph { configuration in
                configuration.label
                    .fixedSize(horizontal: false, vertical: true)
                    .markdownMargin(top: 0, bottom: 0)
            }
    }
}

struct ChatBubbleRow: View {
    let message: Message
    let currentUserID: String?
    let showsSenderInfo: Bool

    private var messageTimestamp: String? {
        guard let date = message.displayDate else {
            return nil
        }

        if Calendar.current.isDateInToday(date) {
            return ChatBubbleRow.timeFormatter.string(from: date)
        }

        return ChatBubbleRow.dateTimeFormatter.string(from: date)
    }

    private static let timeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.dateFormat = "HH:mm"
        return formatter
    }()

    private static let dateTimeFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = .autoupdatingCurrent
        formatter.dateFormat = "M/d HH:mm"
        return formatter
    }()

    private var isMe: Bool {
        normalizeIdentifier(message.senderId) == normalizeIdentifier(currentUserID)
    }

    private var isBot: Bool {
        normalizeIdentifier(message.from.type) == "bot"
    }

    private var isImageMessage: Bool {
        normalizeIdentifier(message.content.type) == "image"
    }

    private var imageURL: URL? {
        guard let imageURLString = message.content.imageURLString else {
            return nil
        }
        return URL(string: imageURLString)
    }

    private var imageName: String {
        let directName = message.content.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let directName, !directName.isEmpty {
            return directName
        }

        let assetName = message.content.asset?.fileName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let assetName, !assetName.isEmpty {
            return assetName
        }

        return "图片"
    }

    private var imageCaption: String? {
        guard isImageMessage else { return nil }
        guard let body = message.content.body?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty else {
            return nil
        }
        guard !message.content.isSticker else { return nil }
        guard normalizeIdentifier(body) != normalizeIdentifier(imageName) else { return nil }
        return body
    }

    private var senderIcon: String {
        isBot ? "cpu.fill" : "person.fill"
    }

    private var senderDisplayName: String {
        let rawName = message.from.name?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !rawName.isEmpty {
            return rawName
        }
        return isBot ? "机器人" : "用户"
    }

    private var avatarFill: LinearGradient {
        if isBot {
            return LinearGradient(
                colors: [Color.rcmsAccent.opacity(0.95), Color(red: 56/255, green: 189/255, blue: 248/255)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }

        return LinearGradient(
            colors: [Color.white, Color(red: 226/255, green: 232/255, blue: 240/255)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isMe {
                Spacer(minLength: 44)
            } else {
                senderAvatar
            }

            VStack(alignment: isMe ? .trailing : .leading, spacing: 4) {
                if !isMe && showsSenderInfo {
                    HStack(spacing: 6) {
                        Text(senderDisplayName)
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.rcmsTextSecondary)

                        if isBot {
                            Text("BOT")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(Color.rcmsAccent)
                                .padding(.horizontal, 6)
                                .padding(.vertical, 2)
                                .background(Color.rcmsAccent.opacity(0.12))
                                .clipShape(Capsule())
                        }
                    }
                    .padding(.horizontal, 4)
                }

                if isImageMessage {
                    imageMessageView
                } else if let body = message.content.body {
                    MessageMarkdownView(text: body, isMe: isMe)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .background(isMe ? Color.rcmsAccent : Color.white.opacity(0.95))
                        .foregroundStyle(isMe ? .white : Color.rcmsTextPrimary)
                        .clipShape(BubbleShape(isMe: isMe))
                        .shadow(color: Color.black.opacity(0.08), radius: 8, x: 0, y: 4)
                }

                if let messageTimestamp {
                    Text(messageTimestamp)
                        .font(.caption2)
                        .foregroundStyle(Color.rcmsTextSecondary)
                        .padding(.horizontal, 4)
                }
            }
            .frame(maxWidth: 300, alignment: isMe ? .trailing : .leading)

            if !isMe {
                Spacer(minLength: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: isMe ? .trailing : .leading)
    }

    private var senderAvatar: some View {
        Circle()
            .fill(avatarFill)
            .frame(width: 30, height: 30)
            .overlay(
                Image(systemName: senderIcon)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(isBot ? .white : Color.rcmsTextSecondary)
            )
            .overlay(Circle().stroke(Color.white.opacity(0.9), lineWidth: 1))
            .shadow(color: Color.black.opacity(0.06), radius: 6, x: 0, y: 3)
    }

    private func normalizeIdentifier(_ value: String?) -> String {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
    }

    private var imageMessageView: some View {
        VStack(alignment: isMe ? .trailing : .leading, spacing: 8) {
            Group {
                if let imageURL {
                    AsyncImage(url: imageURL, transaction: Transaction(animation: .easeInOut(duration: 0.2))) { phase in
                        switch phase {
                        case .empty:
                            imagePlaceholder(label: "图片加载中...")
                        case .success(let image):
                            image
                                .resizable()
                                .scaledToFit()
                        case .failure:
                            imagePlaceholder(label: "图片不可用")
                        @unknown default:
                            imagePlaceholder(label: "图片不可用")
                        }
                    }
                } else {
                    imagePlaceholder(label: "图片不可用")
                }
            }
            .frame(maxWidth: message.content.isSticker ? 160 : 280, maxHeight: message.content.isSticker ? 160 : 320)
            .clipShape(RoundedRectangle(cornerRadius: message.content.isSticker ? 18 : 20, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: message.content.isSticker ? 18 : 20, style: .continuous)
                    .stroke(Color.white.opacity(isMe ? 0.2 : 0.65), lineWidth: message.content.isSticker ? 0 : 1)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 8, x: 0, y: 4)

            if let imageCaption {
                MessageMarkdownView(text: imageCaption, isMe: isMe)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(isMe ? Color.rcmsAccent : Color.white.opacity(0.95))
                    .foregroundStyle(isMe ? .white : Color.rcmsTextPrimary)
                    .clipShape(BubbleShape(isMe: isMe))
                    .shadow(color: Color.black.opacity(0.08), radius: 8, x: 0, y: 4)
            }
        }
    }

    private func imagePlaceholder(label: String) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(isMe ? Color.rcmsAccent.opacity(0.12) : Color.white.opacity(0.9))

            VStack(spacing: 8) {
                Image(systemName: "photo")
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(Color.rcmsTextSecondary)

                Text(label)
                    .font(.caption)
                    .foregroundStyle(Color.rcmsTextSecondary)
            }
            .padding(20)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}


struct BubbleShape: Shape {
    let isMe: Bool

    func path(in rect: CGRect) -> Path {
        let tl: CGFloat = 16
        let tr: CGFloat = 16
        let bl: CGFloat = isMe ? 16 : 4
        let br: CGFloat = isMe ? 4 : 16

        var path = Path()
        path.move(to: CGPoint(x: tl, y: 0))
        path.addLine(to: CGPoint(x: rect.width - tr, y: 0))
        path.addArc(center: CGPoint(x: rect.width - tr, y: tr), radius: tr, startAngle: .degrees(-90), endAngle: .degrees(0), clockwise: false)
        path.addLine(to: CGPoint(x: rect.width, y: rect.height - br))
        path.addArc(center: CGPoint(x: rect.width - br, y: rect.height - br), radius: br, startAngle: .degrees(0), endAngle: .degrees(90), clockwise: false)
        path.addLine(to: CGPoint(x: bl, y: rect.height))
        path.addArc(center: CGPoint(x: bl, y: rect.height - bl), radius: bl, startAngle: .degrees(90), endAngle: .degrees(180), clockwise: false)
        path.addLine(to: CGPoint(x: 0, y: tl))
        path.addArc(center: CGPoint(x: tl, y: tl), radius: tl, startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.closeSubpath()
        return path
    }
}

struct GroupMaintenanceSheet: View {
    @ObservedObject var viewModel: GroupMaintenanceViewModel
    let groupId: String

    var body: some View {
        NavigationStack {
            ZStack {
                FrostedBackground()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        TextField("群名称", text: $viewModel.groupName)
                            .padding(12)
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                        Button("保存群名称") {
                            viewModel.renameGroup(groupId: groupId)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.rcmsAccent)

                        Text("成员")
                            .font(.headline)

                        ForEach(viewModel.members) { member in
                            HStack {
                                Text(member.user?.username ?? member.nickname ?? member.userId.uuidString)
                                Spacer()
                                Button("移除") {
                                    viewModel.removeMember(groupId: groupId, memberId: member.userId)
                                }
                                .foregroundStyle(Color.rcmsDanger)
                            }
                        }

                        if !viewModel.botMembers.isEmpty {
                            Text("机器人成员")
                                .font(.headline)
                            ForEach(viewModel.botMembers) { member in
                                HStack {
                                    Text(member.bot?.name ?? member.nickname ?? member.botId.uuidString)
                                    Spacer()
                                    Text("已加入")
                                        .foregroundStyle(Color.rcmsTextSecondary)
                                        .font(.caption)
                                }
                            }
                        }

                        Text("+ 添加成员")
                            .font(.headline)

                        TextField("搜索机器人", text: $viewModel.searchText)
                            .padding(12)
                            .background(.ultraThinMaterial)
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                        ForEach(viewModel.filteredBots) { bot in
                            HStack {
                                Text(bot.name)
                                Spacer()
                                Button("添加") {
                                    viewModel.addBot(groupId: groupId, botId: bot.id)
                                }
                                .foregroundStyle(Color.rcmsAccent)
                            }
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle("群维护")
            .navigationBarTitleDisplayMode(.large)
        }
    }
}
