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
        return "chat/group/\(group.id.uuidString.lowercased())"
    }

    var body: some View {
        NavigationStack {
            ZStack {
                FrostedBackground()

                ScrollView {
                    VStack(spacing: 0) {
                        searchBar
                            .padding(.top, 8)
                            .padding(.bottom, 10)

                        if viewModel.isLoading {
                            ProgressView()
                                .padding(.top, 32)
                        }

                        ForEach(filteredGroups) { group in
                            NavigationLink {
                                ChatRoomView(context: .init(id: conversationTopic(for: group), title: group.name, subtitle: (group.isActive == true) ? "在线" : "离线", isGroup: true, groupId: group.id.uuidString.lowercased()))
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
            .navigationTitle("Groups")
            .navigationBarTitleDisplayMode(.large)
            .toolbarColorScheme(.light, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                Button {
                    showingCreate = true
                } label: {
                    Image(systemName: "plus")
                        .font(.headline.weight(.semibold))
                        .foregroundStyle(Color.rcmsAccent)
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
                .foregroundStyle(Color.rcmsTextSecondary)
            TextField("搜索群组", text: $searchText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .foregroundStyle(Color.rcmsTextPrimary)
        }
        .padding(12)
        .background(Color(red: 241/255, green: 245/255, blue: 249/255).opacity(0.95))
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
                    .fill(
                        LinearGradient(
                            colors: [Color(red: 224/255, green: 242/255, blue: 254/255), Color(red: 186/255, green: 230/255, blue: 253/255)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 52, height: 52)
                    .overlay(Image(systemName: "person.3.fill").foregroundStyle(Color.rcmsAccent))

                Circle()
                    .fill((group.isActive == true) ? Color.rcmsOnline : Color.rcmsOffline)
                    .frame(width: 11, height: 11)
                    .overlay(Circle().stroke(.white, lineWidth: 2.5))
            }

            VStack(alignment: .leading, spacing: 4) {
                Text(group.name)
                    .font(.headline)
                    .fontWeight(.semibold)
                    .foregroundStyle(Color.rcmsTextStrong)

                Text(group.description ?? "暂无消息")
                    .font(.subheadline)
                    .foregroundStyle(Color.rcmsTextSecondary)
                    .lineLimit(1)
            }

            Spacer()
        }
        .frame(minHeight: 74)
        .padding(.horizontal, 4)
        .padding(.vertical, 8)
        .background(Color.white.opacity(0.7))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.rcmsDivider)
                .frame(height: 1)
        }
    }
}
