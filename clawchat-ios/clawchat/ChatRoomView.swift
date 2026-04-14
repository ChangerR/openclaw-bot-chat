import SwiftUI
import Combine

class ChatRoomViewModel: ObservableObject {
    @Published var messages: [Message] = []
    @Published var inputText = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var connectionState: RealtimeConnectionState = .idle

    let conversationId: String
    private var cancellables = Set<AnyCancellable>()

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

    func fetchMessages() {
        isLoading = true
        APIClient.shared.request("/api/v1/messages/\(conversationId)?limit=50")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (messages: [Message]) in
                // Success: update local messages
                self.messages = messages.reversed()
            }
            .store(in: &cancellables)
    }

    private func handleIncomingMessage(_ message: Message) {
        if !messages.contains(where: { $0.id == message.id }) {
            messages.append(message)
        }
    }

    func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        
        // Optimistic UI: we don't have a full Message object yet, but we can wait for MQTT echo
        // Or create a temporary one. For simplicity, we'll wait for the MQTT echo back.
        
        // We need a topic. Usually it's "chat/dm/..." or "chat/group/..."
        // The conversationId itself often serves as the topic or part of it.
        // In our system, conversationId is normalized to the topic.
        
        let sendTopic = conversationId 
        
        RealtimeService.shared.sendMessage(conversationId: conversationId, text: text, topic: sendTopic)
        inputText = ""
    }
}

struct ChatRoomView: View {
    let conversationId: String
    let title: String
    @StateObject private var viewModel: ChatRoomViewModel

    init(conversationId: String, title: String) {
        self.conversationId = conversationId
        self.title = title
        _viewModel = StateObject(wrappedValue: ChatRoomViewModel(conversationId: conversationId))
    }

    var body: some View {
        VStack {
            if viewModel.connectionState != .connected {
                HStack {
                    Spacer()
                    Text(viewModel.connectionState == .connecting ? "Connecting..." : "Disconnected")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Spacer()
                }
                .padding(.top, 4)
            }
            
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 12) {
                        ForEach(viewModel.messages) { message in
                            MessageBubble(message: message)
                                .id(message.id)
                        }
                    }
                    .padding()
                }
                .onChange(of: viewModel.messages.count) { _ in
                    if let lastId = viewModel.messages.last?.id {
                        proxy.scrollTo(lastId, anchor: .bottom)
                    }
                }
            }
            
            HStack {
                TextField("Message...", text: $viewModel.inputText)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .padding(.horizontal)
                    .disabled(viewModel.connectionState != .connected)
                
                Button(action: viewModel.sendMessage) {
                    Image(systemName: "paperplane.fill")
                        .padding(.trailing)
                }
                .disabled(viewModel.inputText.isEmpty || viewModel.connectionState != .connected)
            }
            .padding(.vertical, 8)
            .background(Color(.systemBackground))
            .shadow(radius: 1)
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            viewModel.fetchMessages()
        }
    }
}

struct MessageBubble: View {
    let message: Message
    let isMe: Bool

    init(message: Message) {
        self.message = message
        self.isMe = message.senderId == AuthManager.shared.currentUser?.id.uuidString
    }

    var body: some View {
        HStack {
            if isMe { Spacer() }
            
            VStack(alignment: isMe ? .trailing : .leading) {
                if let body = message.content.body {
                    Text(body)
                        .padding(10)
                        .background(isMe ? Color.blue : Color(.systemGray6))
                        .foregroundColor(isMe ? .white : .primary)
                        .cornerRadius(12)
                }
            }
            
            if !isMe { Spacer() }
        }
    }
}
