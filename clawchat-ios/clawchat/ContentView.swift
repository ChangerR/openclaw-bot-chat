import SwiftUI

struct ContentView: View {
    @StateObject private var authManager = AuthManager.shared

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                HomeView()
                    .onAppear {
                        RealtimeService.shared.start()
                    }
            } else {
                LoginView()
            }
        }
    }
}

struct HomeView: View {
    var body: some View {
        TabView {
            ConversationsView()
                .tabItem {
                    Label("Chats", systemImage: "bubble.left.and.bubble.right")
                }

            BotsView()
                .tabItem {
                    Label("Bots", systemImage: "cpu")
                }

            GroupsView()
                .tabItem {
                    Label("Groups", systemImage: "person.3")
                }

            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gear")
                }
        }
    }
}

#Preview {
    ContentView()
}
