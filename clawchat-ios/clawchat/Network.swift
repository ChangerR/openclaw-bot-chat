import Foundation
import Combine

class APIClient {
    static let shared = APIClient()
    let baseURL: URL

    private let session: URLSession

    init(session: URLSession = .shared, baseURL: URL = URL(string: "https://test.iotdevices.site")!) {
        self.session = session
        self.baseURL = baseURL
    }

    var brokerWebSocketFallbackURL: URL? {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            return nil
        }

        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.path = "/mqtt"
        components.query = nil
        components.fragment = nil

        return components.url
    }

    enum APIError: LocalizedError {
        case invalidURL
        case noData
        case decodingError
        case serverError(String)
        case unauthorized
        case networkError(Error)

        var errorDescription: String? {
            switch self {
            case .invalidURL:
                return "Invalid server URL"
            case .noData:
                return "No data received from server"
            case .decodingError:
                return "Failed to parse server response"
            case .serverError(let message):
                return message
            case .unauthorized:
                return "Session expired or invalid credentials"
            case .networkError(let error):
                return "Network error: \(error.localizedDescription)"
            }
        }
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()

            if let seconds = try? container.decode(Double.self) {
                return Date(timeIntervalSince1970: seconds)
            }

            let raw = try container.decode(String.self)
            let iso8601 = ISO8601DateFormatter()
            iso8601.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            if let date = iso8601.date(from: raw) {
                return date
            }

            let fallbackISO = ISO8601DateFormatter()
            fallbackISO.formatOptions = [.withInternetDateTime]
            if let date = fallbackISO.date(from: raw) {
                return date
            }

            throw APIError.decodingError
        }
        return decoder
    }()

    func request<T: Codable>(_ endpoint: String,
                            method: String = "GET",
                            body: Data? = nil,
                            requiresAuth: Bool = true) -> AnyPublisher<T, Error> {

        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            return Fail(error: APIError.invalidURL).eraseToAnyPublisher()
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        if requiresAuth, let token = AuthManager.shared.accessToken {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return session.dataTaskPublisher(for: request)
            .mapError { APIError.networkError($0) }
            .tryMap { data, response -> Data in
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw APIError.serverError("Invalid response from server")
                }

                if httpResponse.statusCode == 401 {
                    AuthManager.shared.logout()
                    throw APIError.unauthorized
                }

                if !(200...299).contains(httpResponse.statusCode) {
                    // Try to parse error message from ApiResponse
                    if let apiError = try? Self.decoder.decode(ApiResponse<EmptyResponse>.self, from: data) {
                        throw APIError.serverError(apiError.message)
                    }
                    
                    let errorMessage = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
                    throw APIError.serverError(errorMessage)
                }

                return data
            }
            .decode(type: ApiResponse<T>.self, decoder: Self.decoder)
            .tryMap { apiResponse -> T in
                if apiResponse.code != 0 {
                    throw APIError.serverError(apiResponse.message)
                }
                guard let data = apiResponse.data else {
                    if T.self == EmptyResponse.self {
                        return EmptyResponse() as! T
                    }
                    throw APIError.noData
                }
                return data
            }
            .eraseToAnyPublisher()
    }

    struct EmptyResponse: Codable {}

    func requestValue<T: Codable>(_ endpoint: String,
                                  method: String = "GET",
                                  body: Data? = nil,
                                  requiresAuth: Bool = true) async throws -> T {

        guard let url = URL(string: endpoint, relativeTo: baseURL) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.timeoutInterval = 15
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        if requiresAuth, let token = AuthManager.shared.accessToken {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw APIError.serverError("Invalid response from server")
            }

            if httpResponse.statusCode == 401 {
                AuthManager.shared.logout()
                throw APIError.unauthorized
            }

            if !(200...299).contains(httpResponse.statusCode) {
                // Try to parse error message from ApiResponse
                if let apiError = try? Self.decoder.decode(ApiResponse<EmptyResponse>.self, from: data) {
                    throw APIError.serverError(apiError.message)
                }
                
                let errorMessage = String(data: data, encoding: .utf8) ?? "HTTP \(httpResponse.statusCode)"
                throw APIError.serverError(errorMessage)
            }

            let apiResponse = try Self.decoder.decode(ApiResponse<T>.self, from: data)
            if apiResponse.code != 0 {
                throw APIError.serverError(apiResponse.message)
            }

            guard let payload = apiResponse.data else {
                if T.self == EmptyResponse.self {
                    return EmptyResponse() as! T
                }
                throw APIError.noData
            }

            return payload
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }

    func prepareImageUpload(fileName: String,
                            contentType: String,
                            size: Int,
                            conversationID: String?) async throws -> PreparedUpload {
        let body = try JSONEncoder().encode(
            PrepareImageUploadRequest(
                fileName: fileName,
                contentType: contentType,
                size: size,
                conversationId: conversationID
            )
        )
        return try await requestValue(
            "/api/v1/assets/image/upload-prepare",
            method: "POST",
            body: body
        )
    }

    func completeImageUpload(assetID: String, objectKey: String) async throws -> Asset {
        let body = try JSONEncoder().encode(
            CompleteImageUploadRequest(assetId: assetID, objectKey: objectKey)
        )
        return try await requestValue(
            "/api/v1/assets/image/complete",
            method: "POST",
            body: body
        )
    }

    func uploadImageData(_ data: Data, with upload: PresignedUpload) async throws {
        guard let url = URL(string: upload.url) else {
            throw APIError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = upload.method.isEmpty ? "PUT" : upload.method
        request.timeoutInterval = 60
        request.httpBody = data

        upload.headers?.forEach { key, value in
            request.setValue(value, forHTTPHeaderField: key)
        }

        let (_, response) = try await session.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.serverError("Invalid upload response")
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError("Upload failed with status \(httpResponse.statusCode)")
        }
    }
}

class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isAuthenticated: Bool = false
    @Published var currentUser: User?

    private let userDefaults = UserDefaults.standard
    private let accessTokenKey = "access_token"
    private let refreshTokenKey = "refresh_token"
    private var cancellables = Set<AnyCancellable>()
    private var isRefreshingCurrentUser = false

    var accessToken: String? {
        userDefaults.string(forKey: accessTokenKey)
    }

    init() {
        self.isAuthenticated = accessToken != nil
    }

    func refreshCurrentUserIfNeeded(force: Bool = false) {
        guard isAuthenticated else { return }
        guard force || currentUser == nil else { return }
        guard !isRefreshingCurrentUser else { return }

        isRefreshingCurrentUser = true

        APIClient.shared.request("/api/v1/auth/me")
            .receive(on: DispatchQueue.main)
            .sink { [weak self] completion in
                self?.isRefreshingCurrentUser = false
                if case .failure(let error) = completion {
                    print("Failed to refresh current user: \(error.localizedDescription)")
                }
            } receiveValue: { [weak self] (user: User) in
                self?.currentUser = user
                self?.isAuthenticated = true
            }
            .store(in: &cancellables)
    }

    func login(payload: AuthPayload) {
        userDefaults.set(payload.tokens.accessToken, forKey: accessTokenKey)
        userDefaults.set(payload.tokens.refreshToken, forKey: refreshTokenKey)
        self.currentUser = payload.user
        self.isAuthenticated = true
    }

    func logout() {
        userDefaults.removeObject(forKey: accessTokenKey)
        userDefaults.removeObject(forKey: refreshTokenKey)
        self.currentUser = nil
        self.isAuthenticated = false
        RealtimeService.shared.stop()
    }
}
