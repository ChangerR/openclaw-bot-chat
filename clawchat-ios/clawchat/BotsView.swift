import SwiftUI
import Combine

class BotsViewModel: ObservableObject {
    @Published var bots: [Bot] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    func fetchBots() {
        isLoading = true
        APIClient.shared.request("/api/v1/bots")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (bots: [Bot]) in
                self.bots = bots
            }
            .store(in: &cancellables)
    }

    func createBot(name: String, description: String?, onDone: @escaping () -> Void) {
        let payload: [String: Any?] = [
            "name": name,
            "description": description?.isEmpty == true ? nil : description
        ]

        let data = try? JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 })

        APIClient.shared.request("/api/v1/bots", method: "POST", body: data)
            .receive(on: DispatchQueue.main)
            .sink { completion in
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (_: Bot) in
                self.fetchBots()
                onDone()
            }
            .store(in: &cancellables)
    }
}

struct BotsView: View {
    @StateObject private var viewModel = BotsViewModel()
    @State private var showingCreate = false
    @State private var newName = ""
    @State private var newDescription = ""
    @State private var searchText = ""

    private var filteredBots: [Bot] {
        if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return viewModel.bots
        }

        return viewModel.bots.filter {
            $0.name.localizedCaseInsensitiveContains(searchText)
            || ($0.description?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                FrostedBackground()

                ScrollView {
                    VStack(spacing: 12) {
                        searchBar
                            .padding(.top, 8)

                        if viewModel.isLoading {
                            ProgressView()
                                .padding(.top, 32)
                        }

                        ForEach(filteredBots) { bot in
                            if let topic = bot.mqttTopic {
                                NavigationLink {
                                    ChatRoomView(context: .init(id: topic, title: bot.name, subtitle: bot.status == "online" ? "在线" : "离线", isGroup: false, groupId: nil))
                                } label: {
                                    BotRowCard(bot: bot)
                                }
                                .buttonStyle(.plain)
                            } else {
                                BotRowCard(bot: bot)
                                    .opacity(0.6)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .scrollIndicators(.hidden)
            }
            .navigationTitle("🤖 单聊")
            .toolbar {
                Button {
                    showingCreate = true
                } label: {
                    Image(systemName: "plus")
                        .font(.headline)
                }
            }
            .onAppear { viewModel.fetchBots() }
            .refreshable { viewModel.fetchBots() }
            .sheet(isPresented: $showingCreate) {
                createBotSheet
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)
            TextField("搜索机器人", text: $searchText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
        }
        .padding(12)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var createBotSheet: some View {
        NavigationStack {
            Form {
                TextField("Bot name", text: $newName)
                TextField("Description", text: $newDescription)
            }
            .navigationTitle("创建机器人")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showingCreate = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        viewModel.createBot(name: newName, description: newDescription) {
                            newName = ""
                            newDescription = ""
                            showingCreate = false
                        }
                    }
                    .disabled(newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.medium])
    }
}

struct BotRowCard: View {
    let bot: Bot

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(Color.white.opacity(0.9))
                    .frame(width: 52, height: 52)
                    .overlay(Image(systemName: "cpu.fill").foregroundStyle(.rcmsAccent))

                Circle()
                    .fill((bot.status == "online") ? .rcmsOnline : .rcmsOffline)
                    .frame(width: 11, height: 11)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(bot.name)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundStyle(.primary)

                Text(bot.description ?? "暂无消息")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            Spacer()
        }
        .frame(height: 72)
        .padding(.horizontal, 14)
        .frostedCardStyle()
    }
}
