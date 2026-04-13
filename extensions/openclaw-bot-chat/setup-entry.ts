import { defineBundledSetupEntry } from "openclaw/plugin-sdk/setup-entry-contract";

export default defineBundledSetupEntry({
  id: "bot-chat",
  name: "BotChat Setup",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./setup-plugin-api.js",
    exportName: "botChatSetupPlugin",
  },
});
