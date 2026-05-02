declare module "openclaw/plugin-sdk/channel-entry-contract" {
  export function defineBundledChannelEntry<T>(entry: T): T & {
    kind: "bundled-channel-entry";
  };

  export function defineBundledChannelSetupEntry<T>(entry: T): T & {
    kind: "bundled-channel-setup-entry";
  };
}
