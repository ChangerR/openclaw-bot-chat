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
        NavigationStack {
            ZStack {
                FrostedBackground()

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Settings")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundStyle(Color.rcmsTextStrong)

                        if viewModel.isLoading && viewModel.currentUser == nil {
                            ProgressView()
                                .frame(maxWidth: .infinity, alignment: .center)
                                .padding(.top, 24)
                        } else {
                            VStack(alignment: .leading, spacing: 14) {
                                Text("Account")
                                    .font(.headline)
                                    .foregroundStyle(Color.rcmsTextStrong)

                                detailRow(title: "Username", value: viewModel.currentUser?.username ?? authManager.currentUser?.username ?? "Unknown")
                                detailRow(title: "Email", value: viewModel.currentUser?.email ?? authManager.currentUser?.email ?? "Unknown")
                            }
                            .padding(16)
                            .background(Color.white.opacity(0.9))
                            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

                            Button {
                                authManager.logout()
                            } label: {
                                Text("Logout")
                                    .fontWeight(.semibold)
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 12)
                                    .foregroundStyle(.white)
                                    .background(Color.rcmsDanger)
                                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 24)
                }
            }
            .navigationBarHidden(true)
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

    private func detailRow(title: String, value: String) -> some View {
        HStack {
            Text(title)
                .foregroundStyle(Color.rcmsTextSecondary)
            Spacer()
            Text(value)
                .foregroundStyle(Color.rcmsTextPrimary)
                .fontWeight(.medium)
        }
    }
}
