import SwiftUI
import Combine

class AuthViewModel: ObservableObject {
    @Published var identifier = ""
    @Published var username = ""
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    func login() {
        isLoading = true
        errorMessage = nil

        let trimmedIdentifier = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let body: [String: String] = trimmedIdentifier.contains("@")
            ? ["email": trimmedIdentifier, "password": password]
            : ["username": trimmedIdentifier, "password": password]

        let data = try? JSONEncoder().encode(body)

        APIClient.shared.request("/api/v1/auth/login", method: "POST", body: data, requiresAuth: false)
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (payload: AuthPayload) in
                AuthManager.shared.login(payload: payload)
                RealtimeService.shared.start()
            }
            .store(in: &cancellables)
    }

    func register() {
        isLoading = true
        errorMessage = nil

        let body = ["username": username, "email": email, "password": password]
        let data = try? JSONEncoder().encode(body)

        APIClient.shared.request("/api/v1/auth/register", method: "POST", body: data, requiresAuth: false)
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (payload: AuthPayload) in
                AuthManager.shared.login(payload: payload)
                RealtimeService.shared.start()
            }
            .store(in: &cancellables)
    }
}

struct LoginView: View {
    @StateObject private var viewModel = AuthViewModel()
    @State private var isRegistering = false

    var body: some View {
        NavigationStack {
            ZStack {
                FrostedBackground()

                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Welcome Back")
                            .font(.system(size: 34, weight: .bold))
                            .foregroundStyle(Color.rcmsTextStrong)
                        Text("Sign in to continue to Bot Chat")
                            .font(.subheadline)
                            .foregroundStyle(Color.rcmsTextSecondary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    VStack(spacing: 12) {
                        TextField("Username or Email", text: $viewModel.identifier)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled(true)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(Color.white.opacity(0.8))
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .foregroundStyle(Color.rcmsTextPrimary)

                        SecureField("Password", text: $viewModel.password)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                            .background(Color.white.opacity(0.8))
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                            .foregroundStyle(Color.rcmsTextPrimary)

                        if let error = viewModel.errorMessage {
                            Text(error)
                                .font(.caption)
                                .foregroundStyle(Color.rcmsDanger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        Button(action: viewModel.login) {
                            Group {
                                if viewModel.isLoading {
                                    ProgressView().tint(.white)
                                } else {
                                    Text("Login")
                                        .fontWeight(.semibold)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 13)
                            .background(Color.rcmsAccent)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        .disabled(viewModel.isLoading)
                    }

                    NavigationLink(destination: RegisterView(), isActive: $isRegistering) { EmptyView() }
                        .hidden()

                    Button("Don't have an account? Register") {
                        isRegistering = true
                    }
                    .font(.footnote)
                    .foregroundStyle(Color.rcmsAccent)
                }
                .padding(22)
                .glassCardStyle()
                .padding(.horizontal, 16)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

struct RegisterView: View {
    @StateObject private var viewModel = AuthViewModel()

    var body: some View {
        ZStack {
            FrostedBackground()

            VStack(spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Create Account")
                        .font(.system(size: 34, weight: .bold))
                        .foregroundStyle(Color.rcmsTextStrong)
                    Text("Join Bot Chat and start messaging")
                        .font(.subheadline)
                        .foregroundStyle(Color.rcmsTextSecondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)

                Group {
                    TextField("Username", text: $viewModel.username)
                    TextField("Email", text: $viewModel.email)
                        .keyboardType(.emailAddress)
                    SecureField("Password", text: $viewModel.password)
                }
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled(true)
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .background(Color.white.opacity(0.8))
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .foregroundStyle(Color.rcmsTextPrimary)

                if let error = viewModel.errorMessage {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(Color.rcmsDanger)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                Button(action: viewModel.register) {
                    Group {
                        if viewModel.isLoading {
                            ProgressView().tint(.white)
                        } else {
                            Text("Register")
                                .fontWeight(.semibold)
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 13)
                    .background(Color.rcmsAccent)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                }
                .disabled(viewModel.isLoading)
            }
            .padding(22)
            .glassCardStyle()
            .padding(.horizontal, 16)
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AuthView_Previews: PreviewProvider {
    static var previews: some View {
        LoginView()
    }
}
