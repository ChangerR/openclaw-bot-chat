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
        NavigationView {
            VStack(spacing: 20) {
                Text("OpenClaw Bot Chat")
                    .font(.largeTitle)
                    .fontWeight(.bold)
                    .padding(.bottom, 40)

                TextField("Username or Email", text: $viewModel.identifier)
                    .textFieldStyle(RoundedBorderTextFieldStyle())
                    .autocapitalization(.none)

                SecureField("Password", text: $viewModel.password)
                    .textFieldStyle(RoundedBorderTextFieldStyle())

                if let error = viewModel.errorMessage {
                    Text(error)
                        .foregroundColor(.red)
                        .font(.caption)
                }

                Button(action: viewModel.login) {
                    if viewModel.isLoading {
                        ProgressView()
                    } else {
                        Text("Login")
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.blue)
                            .foregroundColor(.white)
                            .cornerRadius(10)
                    }
                }
                .disabled(viewModel.isLoading)

                NavigationLink(destination: RegisterView(), isActive: $isRegistering) {
                    Button(action: { isRegistering = true }) {
                        Text("Don't have an account? Register")
                            .font(.footnote)
                    }
                }

                Spacer()
            }
            .padding()
            .navigationBarHidden(true)
        }
    }
}

struct RegisterView: View {
    @StateObject private var viewModel = AuthViewModel()

    var body: some View {
        VStack(spacing: 20) {
            Text("Create Account")
                .font(.largeTitle)
                .fontWeight(.bold)
                .padding(.bottom, 40)

            TextField("Username", text: $viewModel.username)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .autocapitalization(.none)

            TextField("Email", text: $viewModel.email)
                .textFieldStyle(RoundedBorderTextFieldStyle())
                .autocapitalization(.none)
                .keyboardType(.emailAddress)

            SecureField("Password", text: $viewModel.password)
                .textFieldStyle(RoundedBorderTextFieldStyle())

            if let error = viewModel.errorMessage {
                Text(error)
                    .foregroundColor(.red)
                    .font(.caption)
            }

            Button(action: viewModel.register) {
                if viewModel.isLoading {
                    ProgressView()
                } else {
                    Text("Register")
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .foregroundColor(.white)
                        .cornerRadius(10)
                }
            }
            .disabled(viewModel.isLoading)

            Spacer()
        }
        .padding()
        .navigationTitle("Register")
    }
}

struct AuthView_Previews: PreviewProvider {
    static var previews: some View {
        LoginView()
    }
}
