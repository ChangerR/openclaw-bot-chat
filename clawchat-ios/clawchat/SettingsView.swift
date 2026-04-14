import SwiftUI
import Combine

class SettingsViewModel: ObservableObject {
    @Published var currentUser: User?
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    func fetchProfile() {
        isLoading = true
        APIClient.shared.request("/api/v1/auth/me")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (user: User) in
                self.currentUser = user
                AuthManager.shared.currentUser = user
            }
            .store(in: &cancellables)
    }
}

struct SettingsView: View {
    @StateObject private var viewModel = SettingsViewModel()
    @StateObject private var authManager = AuthManager.shared

    var body: some View {
        NavigationView {
            List {
                if viewModel.isLoading && viewModel.currentUser == nil {
                    ProgressView()
                } else {
                    Section(header: Text("Account")) {
                        HStack {
                            Text("Username")
                            Spacer()
                            Text(viewModel.currentUser?.username ?? authManager.currentUser?.username ?? "Unknown")
                                .foregroundColor(.gray)
                        }
                        HStack {
                            Text("Email")
                            Spacer()
                            Text(viewModel.currentUser?.email ?? authManager.currentUser?.email ?? "Unknown")
                                .foregroundColor(.gray)
                        }
                    }
                    
                    Section {
                        Button("Logout") {
                            authManager.logout()
                        }
                        .foregroundColor(.red)
                    }
                }
            }
            .navigationTitle("Settings")
            .onAppear {
                viewModel.fetchProfile()
            }
            .alert(isPresented: Binding<Bool>(
                get: { viewModel.errorMessage != nil },
                set: { _ in viewModel.errorMessage = nil }
            )) {
                Alert(title: Text("Error"), message: Text(viewModel.errorMessage ?? ""), dismissButton: .default(Text("OK")))
            }
        }
    }
}
