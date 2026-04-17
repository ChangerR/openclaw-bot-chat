import SwiftUI
import Combine

class ConversationsViewModel: ObservableObject {
    @Published var conversations: [Conversation] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    func fetchConversations() {
        isLoading = true
        APIClient.shared.request("/api/v1/conversations")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (conversations: [Conversation]) in
                self.conversations = conversations
            }
            .store(in: &cancellables)
    }
}

struct ConversationsView: View {
    @StateObject private var viewModel = ConversationsViewModel()

    var body: some View {
        NavigationView {
            List(viewModel.conversations) { conversation in
                NavigationLink(destination: ChatRoomView(conversationId: conversation.id, title: conversation.name)) {
                    ConversationRow(conversation: conversation)
                }
            }
            .navigationTitle("Chats")
            .onAppear {
                viewModel.fetchConversations()
            }
            .refreshable {
                viewModel.fetchConversations()
            }
        }
    }
}

struct ConversationRow: View {
    let conversation: Conversation

    var body: some View {
        HStack {
            Image(systemName: "person.circle.fill")
                .resizable()
                .frame(width: 40, height: 40)
                .foregroundColor(.gray)
            
            VStack(alignment: .leading) {
                Text(conversation.name)
                    .font(.headline)
                if let lastMsg = conversation.lastMessage?.content {
                    Text(lastMsg)
                        .font(.subheadline)
                        .foregroundColor(.gray)
                        .lineLimit(1)
                }
            }
            
            Spacer()
            
            if let count = conversation.unreadCount, count > 0 {
                Circle()
                    .fill(Color.blue)
                    .frame(width: 20, height: 20)
                    .overlay(
                        Text("\(count)")
                            .font(.caption2)
                            .foregroundColor(.white)
                    )
            }
        }
        .padding(.vertical, 4)
    }
}
