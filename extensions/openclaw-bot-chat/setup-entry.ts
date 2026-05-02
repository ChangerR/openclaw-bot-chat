import { defineBundledChannelSetupEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelSetupEntry({
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./setup-plugin-api.js",
    exportName: "botChatSetupPlugin",
  },
  runtime: {
    specifier: "./runtime-api.js",
    exportName: "setBotChatRuntime",
  },
  secrets: {
    specifier: "./secret-config-contract-api.js",
    exportName: "botChatSecrets",
  },
});
