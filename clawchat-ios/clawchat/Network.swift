import Foundation
import Combine

class APIClient {
    static let shared = APIClient()
    private let baseURL = URL(string: "http://localhost:8080")! // Adjust for production

    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    enum APIError: Error {
        case invalidURL
        case noData
        case decodingError
        case serverError(String)
        case unauthorized
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
        request.addValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        if requiresAuth, let token = AuthManager.shared.accessToken {
            request.addValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return session.dataTaskPublisher(for: request)
            .tryMap { data, response -> Data in
                guard let httpResponse = response as? HTTPURLResponse else {
                    throw APIError.serverError("Invalid response")
                }

                if httpResponse.statusCode == 401 {
                    AuthManager.shared.logout()
                    throw APIError.unauthorized
                }

                guard (200...299).contains(httpResponse.statusCode) else {
                    let errorMessage = String(data: data, encoding: .utf8) ?? "Server error"
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
}

class AuthManager: ObservableObject {
    static let shared = AuthManager()

    @Published var isAuthenticated: Bool = false
    @Published var currentUser: User?

    private let userDefaults = UserDefaults.standard
    private let accessTokenKey = "access_token"
    private let refreshTokenKey = "refresh_token"

    var accessToken: String? {
        userDefaults.string(forKey: accessTokenKey)
    }

    init() {
        self.isAuthenticated = accessToken != nil
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
