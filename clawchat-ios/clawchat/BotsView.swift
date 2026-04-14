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

    func createBot(name: String, description: String?, onDone: @escaping () -> Void) {
        let payload: [String: Any?] = [
            "name": name,
            "description": description?.isEmpty == true ? nil : description
        ]

        let data = try? JSONSerialization.data(withJSONObject: payload.compactMapValues { $0 })

        APIClient.shared.request("/api/v1/bots", method: "POST", body: data)
            .receive(on: DispatchQueue.main)
            .sink { completion in
                if case .failure(let error) = completion {
                    self.errorMessage = error.localizedDescription
                }
            } receiveValue: { (_: Bot) in
                self.fetchBots()
                onDone()
            }
            .store(in: &cancellables)
    }
}

struct BotsView: View {
    @StateObject private var viewModel = BotsViewModel()
    @State private var showingCreate = false
    @State private var newName = ""
    @State private var newDescription = ""

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
                Button(action: { showingCreate = true }) {
                    Image(systemName: "plus")
                }
            }
            .sheet(isPresented: $showingCreate) {
                NavigationView {
                    Form {
                        TextField("Bot name", text: $newName)
                        TextField("Description", text: $newDescription)
                    }
                    .navigationTitle("Create Bot")
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") {
                                showingCreate = false
                            }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Create") {
                                viewModel.createBot(name: newName, description: newDescription) {
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
