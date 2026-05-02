import SwiftUI

struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var authManager = AuthManager.shared

    var body: some View {
        Group {
            if authManager.isAuthenticated {
                HomeView()
                    .preferredColorScheme(.light)
                    .onAppear {
                        authManager.refreshCurrentUserIfNeeded()
                        RealtimeService.shared.start()
                    }
                    .onChange(of: scenePhase) { _, newPhase in
                        guard newPhase == .active else { return }
                        authManager.refreshCurrentUserIfNeeded()
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
            .tint(Color.rcmsAccent)
            .toolbarBackground(.visible, for: .tabBar)
            .toolbarBackground(Color.white.opacity(0.7), for: .tabBar)
        }
    }
}

#Preview {
    ContentView()
}
