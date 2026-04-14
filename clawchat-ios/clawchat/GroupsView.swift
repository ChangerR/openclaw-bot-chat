import SwiftUI
import Combine

class GroupsViewModel: ObservableObject {
    @Published var groups: [ChatGroup] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    func fetchGroups() {
        isLoading = true
        APIClient.shared.request("/api/v1/groups")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (groups: [ChatGroup]) in
                self.groups = groups
            }
            .store(in: &cancellables)
    }

    func createGroup(name: String, description: String?, onDone: @escaping () -> Void) {
        let payload: [String: Any?] = [
            "name": name,
            "description": description?.isEmpty == true ? nil : description
        ]

        let data = try? JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 })

        APIClient.shared.request("/api/v1/groups", method: "POST", body: data)
            .receive(on: DispatchQueue.main)
            .sink { completion in
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (_: ChatGroup) in
                self.fetchGroups()
                onDone()
            }
            .store(in: &cancellables)
    }
}

struct GroupsView: View {
    @StateObject private var viewModel = GroupsViewModel()
    @State private var showingCreate = false
    @State private var newName = ""
    @State private var newDescription = ""
    @State private var searchText = ""

    private var filteredGroups: [ChatGroup] {
        if searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return viewModel.groups
        }

        return viewModel.groups.filter {
            $0.name.localizedCaseInsensitiveContains(searchText)
            || ($0.description?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    private func conversationTopic(for group: ChatGroup) -> String {
        if let mqttTopic = group.mqttTopic, !mqttTopic.isEmpty {
            return mqttTopic
        }

        return "chat/group/\(group.id.uuidString)"
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

                        ForEach(filteredGroups) { group in
                            NavigationLink {
                                ChatRoomView(context: .init(id: conversationTopic(for: group), title: group.name, subtitle: (group.isActive == true) ? "在线" : "离线", isGroup: true, groupId: group.id.uuidString))
                            } label: {
                                GroupRowCard(group: group)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .scrollIndicators(.hidden)
            }
            .navigationTitle("👥 群组")
            .toolbar {
                Button {
                    showingCreate = true
                } label: {
                    Image(systemName: "plus")
                        .font(.headline)
                }
            }
            .onAppear { viewModel.fetchGroups() }
            .refreshable { viewModel.fetchGroups() }
            .sheet(isPresented: $showingCreate) {
                createGroupSheet
            }
        }
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .foregroundColor(.secondary)
            TextField("搜索群组", text: $searchText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
        }
        .padding(12)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var createGroupSheet: some View {
        NavigationStack {
            Form {
                TextField("Group name", text: $newName)
                TextField("Description", text: $newDescription)
            }
            .navigationTitle("创建群组")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { showingCreate = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        viewModel.createGroup(name: newName, description: newDescription) {
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

struct GroupRowCard: View {
    let group: ChatGroup

    var body: some View {
        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(Color.white.opacity(0.9))
                    .frame(width: 52, height: 52)
                    .overlay(Image(systemName: "person.3.fill").foregroundStyle(.rcmsAccent))

                Circle()
                    .fill((group.isActive == true) ? .rcmsOnline : .rcmsOffline)
                    .frame(width: 11, height: 11)
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(group.name)
                    .font(.headline)
                    .fontWeight(.semibold)

                Text(group.description ?? "暂无消息")
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
