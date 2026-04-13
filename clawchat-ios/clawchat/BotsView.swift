import SwiftUI
import Combine

class BotsViewModel: ObservableObject {
    @Published var bots: [Bot] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    private var cancellables = Set<AnyCancellable>()

    func fetchBots() {
        isLoading = true
        APIClient.shared.request("/api/v1/bots")
            .receive(on: DispatchQueue.main)
            .sink { completion in
                self.isLoading = false
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (bots: [Bot]) in
                self.bots = bots
            }
            .store(in: &cancellables)
    }
}

struct BotsView: View {
    @StateObject private var viewModel = BotsViewModel()

    var body: some View {
        NavigationView {
            List(viewModel.bots) { bot in
                VStack(alignment: .leading) {
                    Text(bot.name)
                        .font(.headline)
                    if let desc = bot.description {
                        Text(desc)
                            .font(.subheadline)
                            .foregroundColor(.gray)
                    }
                }
            }
            .navigationTitle("Bots")
            .onAppear {
                viewModel.fetchBots()
            }
            .toolbar {
                Button(action: { /* Create Bot logic */ }) {
                    Image(systemName: "plus")
                }
            }
        }
    }
}
