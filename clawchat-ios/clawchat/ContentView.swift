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
        ZStack {
            FrostedBackground()

            TabView {
                BotsView()
                    .tabItem {
                        Label("单聊", systemImage: "message")
                    }

                GroupsView()
                    .tabItem {
                        Label("群组", systemImage: "person.3.fill")
                    }

                SettingsView()
                    .tabItem {
                        Label("设置", systemImage: "gearshape.fill")
                    }
            }
            .tint(.rcmsAccent)
        }
    }
}

#Preview {
    ContentView()
}
