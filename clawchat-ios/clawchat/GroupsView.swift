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
}

struct GroupsView: View {
    @StateObject private var viewModel = GroupsViewModel()

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
                Button(action: { /* Create Group logic */ }) {
                    Image(systemName: "plus")
                }
            }
        }
    }
}
