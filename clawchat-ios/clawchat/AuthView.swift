import SwiftUI
import Combine

class AuthViewModel: ObservableObject {
    @Published var identifier = ""
    @Published var username = ""
    @Published var email = ""
    @Published var password = ""
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var fieldErrors: [String: String] = [:]

    private var cancellables = Set<AnyCancellable>()

    func validateLogin() -> Bool {
        fieldErrors = [:]
        var isValid = true
        
        if identifier.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fieldErrors["identifier"] = "Username or email is required"
            isValid = false
        }
        
        if password.isEmpty {
            fieldErrors["password"] = "Password is required"
            isValid = false
        }
        
        return isValid
    }

    func login() {
        guard validateLogin() else { return }
        
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
                    if let apiError = error as? APIClient.APIError {
                        self.errorMessage = apiError.errorDescription
                    } else {
                        self.errorMessage = error.localizedDescription
                    }
                }
            } receiveValue: { (payload: AuthPayload) in
                AuthManager.shared.login(payload: payload)
                RealtimeService.shared.start()
            }
            .store(in: &cancellables)
    }

    func validateRegister() -> Bool {
        fieldErrors = [:]
        var isValid = true
        
        if username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fieldErrors["username"] = "Username is required"
            isValid = false
        } else if username.count < 3 {
            fieldErrors["username"] = "Username must be at least 3 characters"
            isValid = false
        }
        
        if email.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            fieldErrors["email"] = "Email is required"
            isValid = false
        } else if !email.contains("@") {
            fieldErrors["email"] = "Invalid email format"
            isValid = false
        }
        
        if password.isEmpty {
            fieldErrors["password"] = "Password is required"
            isValid = false
        } else if password.count < 8 {
            fieldErrors["password"] = "Password must be at least 8 characters"
            isValid = false
        }
        
        return isValid
    }

    func register() {
        guard validateRegister() else { return }
        
        isLoading = true
        errorMessage = nil

        let body = ["username": username, "email": email, "password": password]
        let data = try? JSONEncoder().encode(body)

        APIClient.shared.request("/api/v1/auth/register", method: "POST", body: data, requiresAuth: false)
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    if let apiError = error as? APIClient.APIError {
                        self.errorMessage = apiError.errorDescription
                    } else {
                        self.errorMessage = error.localizedDescription
                    }
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

                ScrollView {
                    VStack(spacing: 32) {
                        // Hero Section
                        VStack(spacing: 16) {
                            Image("AppLogo")
                                .resizable()
                                .scaledToFit()
                                .frame(width: 100, height: 100)
                                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                                .shadow(color: Color.black.opacity(0.1), radius: 20, y: 10)
                                .padding(.top, 40)

                            VStack(spacing: 8) {
                                Text("Welcome Back")
                                    .font(.system(size: 32, weight: .bold, design: .rounded))
                                    .foregroundStyle(Color.rcmsTextStrong)
                                Text("Sign in to continue to Bot Chat")
                                    .font(.subheadline)
                                    .foregroundStyle(Color.rcmsTextSecondary)
                            }
                        }

                        // Form Section
                        VStack(spacing: 20) {
                            VStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    TextField("Username or Email", text: $viewModel.identifier)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled(true)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 14)
                                        .background(Color.white.opacity(0.9))
                                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(viewModel.fieldErrors["identifier"] != nil ? Color.rcmsDanger.opacity(0.5) : Color.black.opacity(0.05), lineWidth: 1))
                                        .foregroundStyle(Color.rcmsTextPrimary)
                                    
                                    if let fieldError = viewModel.fieldErrors["identifier"] {
                                        Text(fieldError)
                                            .font(.caption2)
                                            .foregroundStyle(Color.rcmsDanger)
                                            .padding(.horizontal, 4)
                                    }
                                }

                                VStack(alignment: .leading, spacing: 4) {
                                    SecureField("Password", text: $viewModel.password)
                                        .padding(.horizontal, 16)
                                        .padding(.vertical, 14)
                                        .background(Color.white.opacity(0.9))
                                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 16).stroke(viewModel.fieldErrors["password"] != nil ? Color.rcmsDanger.opacity(0.5) : Color.black.opacity(0.05), lineWidth: 1))
                                        .foregroundStyle(Color.rcmsTextPrimary)
                                    
                                    if let fieldError = viewModel.fieldErrors["password"] {
                                        Text(fieldError)
                                            .font(.caption2)
                                            .foregroundStyle(Color.rcmsDanger)
                                            .padding(.horizontal, 4)
                                    }
                                }
                            }

                            if let error = viewModel.errorMessage {
                                HStack {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .font(.caption)
                                    Text(error)
                                        .font(.caption)
                                }
                                .foregroundStyle(Color.rcmsDanger)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(10)
                                .background(Color.rcmsDanger.opacity(0.1))
                                .clipShape(RoundedRectangle(cornerRadius: 8))
                            }

                            Button(action: viewModel.login) {
                                Group {
                                    if viewModel.isLoading {
                                        ProgressView().tint(.white)
                                    } else {
                                        Text("Login")
                                            .font(.headline)
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(Color.rcmsAccent)
                                .foregroundStyle(.white)
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                .shadow(color: Color.rcmsAccent.opacity(0.3), radius: 10, y: 5)
                            }
                            .disabled(viewModel.isLoading)
                        }
                        .padding(24)
                        .glassCardStyle()
                        .padding(.horizontal, 20)

                        // Footer Navigation
                        NavigationLink(destination: RegisterView(), isActive: $isRegistering) { EmptyView() }.hidden()
                        Button {
                            isRegistering = true
                        } label: {
                            HStack(spacing: 4) {
                                Text("Don't have an account?")
                                    .foregroundStyle(Color.rcmsTextSecondary)
                                Text("Register")
                                    .fontWeight(.bold)
                                    .foregroundStyle(Color.rcmsAccent)
                            }
                            .font(.footnote)
                        }
                    }
                }
            }
            .toolbar(.hidden, for: .navigationBar)
        }
    }
}

struct RegisterView: View {
    @StateObject private var viewModel = AuthViewModel()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ZStack {
            FrostedBackground()

            ScrollView {
                VStack(spacing: 32) {
                    // Hero Section
                    VStack(spacing: 16) {
                        Image("AppLogo")
                            .resizable()
                            .scaledToFit()
                            .frame(width: 80, height: 80)
                            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                            .shadow(color: Color.black.opacity(0.1), radius: 15, y: 8)
                            .padding(.top, 20)

                        VStack(spacing: 8) {
                            Text("Create Account")
                                .font(.system(size: 32, weight: .bold, design: .rounded))
                                .foregroundStyle(Color.rcmsTextStrong)
                            Text("Join Bot Chat and start messaging")
                                .font(.subheadline)
                                .foregroundStyle(Color.rcmsTextSecondary)
                        }
                    }

                    // Form Section
                    VStack(spacing: 20) {
                        VStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                TextField("Username", text: $viewModel.username)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled(true)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 14)
                                    .background(Color.white.opacity(0.9))
                                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(viewModel.fieldErrors["username"] != nil ? Color.rcmsDanger.opacity(0.5) : Color.black.opacity(0.05), lineWidth: 1))
                                    .foregroundStyle(Color.rcmsTextPrimary)
                                
                                if let fieldError = viewModel.fieldErrors["username"] {
                                    Text(fieldError)
                                        .font(.caption2)
                                        .foregroundStyle(Color.rcmsDanger)
                                        .padding(.horizontal, 4)
                                }
                            }
                            
                            VStack(alignment: .leading, spacing: 4) {
                                TextField("Email", text: $viewModel.email)
                                    .keyboardType(.emailAddress)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled(true)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 14)
                                    .background(Color.white.opacity(0.9))
                                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(viewModel.fieldErrors["email"] != nil ? Color.rcmsDanger.opacity(0.5) : Color.black.opacity(0.05), lineWidth: 1))
                                    .foregroundStyle(Color.rcmsTextPrimary)
                                
                                if let fieldError = viewModel.fieldErrors["email"] {
                                    Text(fieldError)
                                        .font(.caption2)
                                        .foregroundStyle(Color.rcmsDanger)
                                        .padding(.horizontal, 4)
                                }
                            }
                            
                            VStack(alignment: .leading, spacing: 4) {
                                SecureField("Password", text: $viewModel.password)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled(true)
                                    .padding(.horizontal, 16)
                                    .padding(.vertical, 14)
                                    .background(Color.white.opacity(0.9))
                                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(viewModel.fieldErrors["password"] != nil ? Color.rcmsDanger.opacity(0.5) : Color.black.opacity(0.05), lineWidth: 1))
                                    .foregroundStyle(Color.rcmsTextPrimary)
                                
                                if let fieldError = viewModel.fieldErrors["password"] {
                                    Text(fieldError)
                                        .font(.caption2)
                                        .foregroundStyle(Color.rcmsDanger)
                                        .padding(.horizontal, 4)
                                }
                            }
                        }

                        if let error = viewModel.errorMessage {
                            HStack {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.caption)
                                Text(error)
                                    .font(.caption)
                            }
                            .foregroundStyle(Color.rcmsDanger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(Color.rcmsDanger.opacity(0.1))
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                        }

                        Button(action: viewModel.register) {
                            Group {
                                if viewModel.isLoading {
                                    ProgressView().tint(.white)
                                } else {
                                    Text("Register")
                                        .font(.headline)
                                }
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 16)
                            .background(Color.rcmsAccent)
                            .foregroundStyle(.white)
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            .shadow(color: Color.rcmsAccent.opacity(0.3), radius: 10, y: 5)
                        }
                        .disabled(viewModel.isLoading)
                    }
                    .padding(24)
                    .glassCardStyle()
                    .padding(.horizontal, 20)
                    
                    Button {
                        dismiss()
                    } label: {
                        HStack(spacing: 4) {
                            Text("Already have an account?")
                                .foregroundStyle(Color.rcmsTextSecondary)
                            Text("Sign in")
                                .fontWeight(.bold)
                                .foregroundStyle(Color.rcmsAccent)
                        }
                        .font(.footnote)
                    }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct AuthView_Previews: PreviewProvider {
    static var previews: some View {
        LoginView()
    }
}
