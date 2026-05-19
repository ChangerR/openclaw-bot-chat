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
    @State private var selectedTab: MainTab = .home

    var body: some View {
        ZStack {
            FrostedBackground()

            TabView(selection: $selectedTab) {
                HomeDashboardView()
                .tabItem {
                    Label("Home", systemImage: "house.fill")
                }
                .tag(MainTab.home)

                BotsView()
                    .tabItem {
                        Label("Bots", systemImage: "cpu.fill")
                    }
                    .tag(MainTab.bots)

                GroupsView()
                    .tabItem {
                        Label("Groups", systemImage: "person.3.fill")
                    }
                    .tag(MainTab.groups)

                SettingsView()
                    .tabItem {
                        Label("Settings", systemImage: "gearshape.fill")
                    }
                    .tag(MainTab.settings)
            }
            .tint(Color.rcmsAccent)
            .toolbarBackground(.visible, for: .tabBar)
            .toolbarBackground(Color.white.opacity(0.7), for: .tabBar)
        }
    }

    private enum MainTab: Hashable {
        case home
        case bots
        case groups
        case settings
    }
}

#Preview {
    ContentView()
}
