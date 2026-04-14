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

    var body: some View {
        NavigationView {
            List(viewModel.groups) { group in
                VStack(alignment: .leading) {
                    Text(group.name)
                        .font(.headline)
                    if let desc = group.description {
                        Text(desc)
                            .font(.subheadline)
                            .foregroundColor(.gray)
                    }
                }
            }
            .navigationTitle("Groups")
            .onAppear {
                viewModel.fetchGroups()
            }
            .toolbar {
                Button(action: { showingCreate = true }) {
                    Image(systemName: "plus")
                }
            }
            .sheet(isPresented: $showingCreate) {
                NavigationView {
                    Form {
                        TextField("Group name", text: $newName)
                        TextField("Description", text: $newDescription)
                    }
                    .navigationTitle("Create Group")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") {
                                showingCreate = false
                            }
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
            }
        }
    }
}
