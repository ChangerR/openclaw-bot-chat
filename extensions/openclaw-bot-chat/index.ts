import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "bot-chat",
  name: "BotChat",
  description: "BotChat channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "botChatPlugin",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setBotChatRuntime",
  },
  secrets: {
    specifier: "./secret-config-contract-api.js",
    exportName: "botChatSecrets",
  },
  accountInspect: {
    specifier: "./account-inspect-api.js",
    exportName: "inspectBotChatReadOnlyAccount",
  },
});
