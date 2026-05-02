import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBotChatOutboundMessageTarget,
  buildBotChatOutboundPayload,
  buildBotChatStatePath,
  collectBotChatConfigIssues,
  evaluateBotChatAccess,
  getBotChatRuntime,
  hasBotChatConfiguredState,
  inferBotChatTargetChatType,
  isBotChatSenderAllowed,
  normalizeAllowFromEntries,
  normalizeBotChatConfig,
  normalizeBotChatInboundMessage,
  normalizeBotChatTarget,
  normalizeAllowFromEntry,
  parseBotChatTarget,
  resolveBotChatAccount,
  setBotChatRuntime,
  buildBotChatDirectTopic,
  buildBotChatGroupTopic,
  buildBotChatHistoryMessagesUrl,
} from '../src/runtime.ts';
import { inspectBotChatAccount } from '../src/account-inspect.ts';
import { botChatPlugin } from '../src/channel.ts';
import { botChatSetupPlugin } from '../src/channel.setup.ts';
import { botChatDoctor } from '../src/doctor.ts';
import { botChatSecrets } from '../src/secret-config-contract.ts';
import { botChatStatus } from '../src/status.ts';

test('normalizeBotChatConfig falls back to env and defaults', () => {
  const config = normalizeBotChatConfig({}, {
    BOT_CHAT_BACKEND_URL: 'http://localhost:8080',
    BOT_CHAT_BOT_KEY: 'secret-key',
    BOT_CHAT_BOT_ID: 'bot-1',
    BOT_CHAT_MQTT_TCP_URL: 'mqtt://localhost:1883',
  });

  assert.equal(config.backendUrl, 'http://localhost:8080');
  assert.equal(config.botKey, 'secret-key');
  assert.equal(config.botId, 'bot-1');
  assert.equal(config.mqttTcpUrl, 'mqtt://localhost:1883');
  assert.equal(config.historyCatchupLimit, 100);
  assert.equal(config.enabled, true);
});

test('resolveBotChatAccount reads nested channel config', () => {
  const account = resolveBotChatAccount({
    channels: {
      'bot-chat': {
        backendUrl: 'http://backend',
        botKey: 'key',
        botId: 'bot-a',
        allowFrom: ['user-1'],
      },
    },
  });

  assert.equal(account.configured, true);
  assert.equal(account.botId, 'bot-a');
  assert.deepEqual(account.config.allowFrom, ['user-1']);
});

test('hasBotChatConfiguredState reports false when required config missing', () => {
  assert.equal(hasBotChatConfiguredState({ cfg: {} }), false);
  assert.equal(
    hasBotChatConfiguredState({
      cfg: { channels: { 'bot-chat': { backendUrl: 'http://backend', botKey: 'k' } } },
    }),
    true,
  );
});

test('target parser normalizes direct, channel, and raw targets', () => {
  assert.deepEqual(parseBotChatTarget('dm:alice'), {
    kind: 'direct',
    id: 'alice',
    raw: 'dm:alice',
  });
  assert.deepEqual(parseBotChatTarget('channel:conv-1'), {
    kind: 'channel',
    id: 'conv-1',
    raw: 'channel:conv-1',
  });
  assert.deepEqual(parseBotChatTarget('conv-1'), {
    kind: 'channel',
    id: 'conv-1',
    raw: 'conv-1',
  });
  assert.deepEqual(parseBotChatTarget('group:group-1'), {
    kind: 'channel',
    id: 'chat/group/group-1',
    raw: 'group:group-1',
  });
  assert.equal(normalizeBotChatTarget('alice-room'), 'channel:alice-room');
  assert.equal(normalizeBotChatTarget('user:alice'), 'dm:alice');
  assert.equal(inferBotChatTargetChatType('dm:alice'), 'direct');
  assert.equal(inferBotChatTargetChatType('conversation:conv-1'), 'channel');
  assert.throws(() => parseBotChatTarget('   '), /target is required/);
});

test('outbound target builder maps direct and channel targets', () => {
  const account = resolveBotChatAccount({ backendUrl: 'http://b', botKey: 'k', botId: 'bot-a' });
  assert.deepEqual(buildBotChatOutboundMessageTarget({ raw: 'dm:alice', account }), {
    channelId: 'chat/dm/user/alice/bot/bot-a',
    userId: 'alice',
    normalizedTarget: 'dm:alice',
    chatType: 'direct',
    publishTopic: 'chat/dm/user/alice/bot/bot-a',
    recipientType: 'user',
  });
  assert.deepEqual(buildBotChatOutboundMessageTarget({ raw: 'conv-1', account }), {
    channelId: 'conv-1',
    userId: 'bot-a',
    normalizedTarget: 'channel:conv-1',
    chatType: 'channel',
    publishTopic: 'conv-1',
    recipientType: 'user',
  });
  assert.deepEqual(buildBotChatOutboundMessageTarget({ raw: 'group:group-1', account }), {
    channelId: 'chat/group/group-1',
    userId: 'bot-a',
    normalizedTarget: 'channel:chat/group/group-1',
    chatType: 'channel',
    publishTopic: 'chat/group/group-1',
    recipientType: 'group',
  });
  assert.deepEqual(
    buildBotChatOutboundMessageTarget({
      raw: 'channel:conv-1',
      account,
      metadata: { userId: 'user-a' },
    }),
    {
      channelId: 'conv-1',
      userId: 'user-a',
      normalizedTarget: 'channel:conv-1',
      chatType: 'channel',
      publishTopic: 'conv-1',
      recipientType: 'user',
    },
  );
  assert.equal(buildBotChatDirectTopic('bot-z', 'bot-a'), 'chat/dm/user/bot-z/bot/bot-a');
  assert.equal(buildBotChatGroupTopic('chat/group/existing'), 'chat/group/existing');
});

test('normalize allowFrom strips provider prefixes and empties', () => {
  assert.deepEqual(normalizeAllowFromEntries([' user:alice ', 'sender:bob', '*', '']), [
    'alice',
    'bob',
    '*',
  ]);
  assert.equal(normalizeAllowFromEntry('botchat:carol'), 'carol');
});

test('allowFrom matcher supports explicit ids and wildcard', () => {
  assert.equal(isBotChatSenderAllowed({ allowFrom: ['alice'], userId: 'user:alice' }), true);
  assert.equal(isBotChatSenderAllowed({ allowFrom: ['*'], userId: 'whoever' }), true);
  assert.equal(isBotChatSenderAllowed({ allowFrom: ['alice'], userId: 'bob' }), false);
});

test('access evaluation uses allowFrom as primary gate', () => {
  const denied = evaluateBotChatAccess({
    config: { allowFrom: ['alice'] },
    message: { channelId: 'c1', userId: 'bob', text: 'hello' },
  });
  assert.deepEqual(denied, {
    allowed: false,
    reason: 'sender not approved in allowFrom',
    requiresCustomApproval: false,
  });

  const blocked = evaluateBotChatAccess({
    config: { allowFrom: ['alice'], permissionApprovalEnabled: true },
    message: { channelId: 'c1', userId: 'alice', text: 'hello', metadata: { blocked: true } },
  });
  assert.deepEqual(blocked, {
    allowed: false,
    reason: 'message blocked by metadata',
    requiresCustomApproval: true,
  });
});

test('normalize inbound payload extracts message fields, metadata, and thread hints', () => {
  const message = normalizeBotChatInboundMessage(
    {
      id: 'm1',
      seq: 42,
      conversation_id: 'conv-1',
      thread_id: 'thread-1',
      reply_to_id: 'm0',
      from: { id: 'user-1' },
      content: { body: 'hello', meta: { blocked: false, source: 'test' } },
    },
    'topic/inbound',
  );

  assert.deepEqual(message, {
    channelId: 'conv-1',
    userId: 'user-1',
    text: 'hello',
    metadata: {
      topic: 'topic/inbound',
      message_id: 'm1',
      seq: 42,
      blocked: false,
      source: 'test',
      threadId: 'thread-1',
      replyToId: 'm0',
    },
  });
});

test('normalize inbound payload accepts thread hints from content metadata', () => {
  const message = normalizeBotChatInboundMessage(
    {
      conversation_id: 'conv-1',
      from: { id: 'user-1' },
      content: { body: 'hello', meta: { threadId: 'thread-meta', replyToId: 'm-meta' } },
    },
    'topic/inbound',
  );

  assert.equal(message.metadata.threadId, 'thread-meta');
  assert.equal(message.metadata.replyToId, 'm-meta');
});

test('outbound payload preserves text, target ids, and thread metadata', () => {
  const payload = JSON.parse(
    buildBotChatOutboundPayload({
      channelId: 'conv-2',
      userId: 'user-2',
      text: 'reply',
      metadata: {
        topic: 'topic/out',
        threadId: 'thread-2',
        replyToId: 'm1',
        botId: 'bot-2',
        toType: 'group',
        publishTopic: 'internal-topic',
      },
    }),
  );

  assert.equal(payload.conversation_id, 'conv-2');
  assert.equal(payload.thread_id, 'thread-2');
  assert.equal(payload.reply_to_id, 'm1');
  assert.equal(payload.from.id, 'bot-2');
  assert.equal(payload.to.type, 'group');
  assert.equal(payload.to.id, 'user-2');
  assert.equal(payload.content.body, 'reply');
  assert.equal(payload.content.meta.topic, 'topic/out');
  assert.equal('botId' in payload.content.meta, false);
  assert.equal('toType' in payload.content.meta, false);
  assert.equal('publishTopic' in payload.content.meta, false);
});

test('state path stays scoped by bot id', () => {
  assert.equal(
    buildBotChatStatePath({ stateDir: './data', botId: 'bot-z' }),
    'data/botchat-bot-z-state.json',
  );
});

test('diagnostics report errors and warnings without leaking secrets', () => {
  const issues = collectBotChatConfigIssues({
    botKey: 'super-secret',
    historyCatchupLimit: 0,
    permissionApprovalEnabled: true,
  });
  assert.deepEqual(
    issues.map((issue) => [issue.severity, issue.code, issue.path]),
    [
      ['error', 'missing_backend_url', 'backendUrl'],
      ['error', 'invalid_history_catchup_limit', 'historyCatchupLimit'],
      ['warning', 'approval_without_handler', 'permissionApprovalEnabled'],
      ['warning', 'empty_allow_from', 'allowFrom'],
    ],
  );
  assert.equal(JSON.stringify(issues).includes('super-secret'), false);
});

test('diagnostics accept configured botKey secret refs without leaking ref values', () => {
  const issues = collectBotChatConfigIssues({
    backendUrl: 'http://backend',
    botKey: { source: 'env', provider: 'default', id: 'BOT_CHAT_BOT_KEY' },
    allowFrom: ['alice'],
  });

  assert.equal(issues.some((issue) => issue.code === 'missing_bot_key'), false);
  assert.equal(JSON.stringify(issues).includes('BOT_CHAT_BOT_KEY'), false);
});

test('status snapshot exposes safe operational fields', () => {
  const snapshot = botChatStatus.getSnapshot({
    cfg: {
      backendUrl: 'http://backend',
      botKey: 'secret',
      botId: 'bot-a',
      stateDir: './data',
      defaultTo: 'channel:main',
      allowFrom: ['alice', 'bob'],
      historyCatchupLimit: 10,
    },
    runtimeState: { connected: true },
  });

  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.approvalMode, 'pairing');
  assert.equal(snapshot.allowFromCount, 2);
  assert.equal(snapshot.hasDefaultTo, true);
  assert.equal(snapshot.historyCatchupLimit, 10);
  assert.equal(snapshot.statePathConfigured, true);
  assert.equal(JSON.stringify(snapshot).includes('secret'), false);
});

test('botChatPlugin exposes formal channel plugin surface', () => {
  assert.equal(botChatPlugin.id, 'bot-chat');
  assert.equal(botChatPlugin.meta.label, 'BotChat');
  assert.deepEqual(botChatPlugin.capabilities.chatTypes, ['direct', 'channel']);
  assert.equal(botChatPlugin.capabilities.threads, false);
  assert.ok(botChatPlugin.config);
  assert.ok(botChatPlugin.setup);
  assert.ok(botChatPlugin.status);
  assert.ok(botChatPlugin.gateway);
  assert.ok(botChatPlugin.outbound);
  assert.ok(botChatPlugin.doctor);
  assert.ok(botChatPlugin.secrets);
  assert.ok(botChatPlugin.allowlist);
  assert.ok(botChatPlugin.pairing);
  assert.equal(botChatPlugin.messaging.normalizeTarget('dm:alice'), 'dm:alice');
  assert.equal(botChatPlugin.messaging.normalizeTarget('conv-1'), 'channel:conv-1');
  assert.equal(botChatPlugin.messaging.inferTargetChatType({ to: 'dm:alice' }), 'direct');
  assert.equal(botChatPlugin.approvalCapability.mode, 'pairing');
  assert.equal(botChatPlugin.approvalCapability.secondaryGate, 'custom-approval');
  assert.equal(botChatPlugin.security.mode, 'allowFrom');
});

test('account inspector reports botKey source without leaking describe snapshots', () => {
  const fromConfig = inspectBotChatAccount({
    cfg: { backendUrl: 'http://backend', botKey: 'secret-key', name: 'Configured BotChat' },
  });
  assert.equal(fromConfig.accountId, 'default');
  assert.equal(fromConfig.botKeySource, 'config');
  assert.equal(fromConfig.botKeyStatus, 'available');
  assert.equal(fromConfig.configured, true);

  const fromEnv = inspectBotChatAccount({
    cfg: { backendUrl: 'http://backend' },
    envBotKey: 'env-secret',
  });
  assert.equal(fromEnv.botKeySource, 'env');
  assert.equal(fromEnv.botKeyStatus, 'available');
  assert.equal(fromEnv.configured, true);

  const fromSecretRef = inspectBotChatAccount({
    cfg: {
      backendUrl: 'http://backend',
      botKey: { source: 'env', provider: 'default', id: 'BOT_CHAT_BOT_KEY' },
    },
  });
  assert.equal(fromSecretRef.botKeySource, 'config');
  assert.equal(fromSecretRef.botKeyStatus, 'configured_unavailable');
  assert.equal(fromSecretRef.configured, true);
  assert.equal(
    JSON.stringify(botChatPlugin.config.describeAccount(resolveBotChatAccount(fromConfig.config))).includes('secret-key'),
    false,
  );
});

test('doctor adapter maps config issues into formal warnings', async () => {
  const warnings = await botChatDoctor.collectPreviewWarnings({
    cfg: { backendUrl: 'http://backend', botKey: 'secret-key', allowFrom: [] },
    doctorFixCommand: 'openclaw doctor --fix',
  });
  assert.deepEqual(warnings, [
    '- BotChat warning empty_allow_from at allowFrom: allowFrom is empty; BotChat currently allows all senders until pairing writes allowFrom entries',
  ]);

  const sequence = await botChatDoctor.runConfigSequence({
    cfg: { historyCatchupLimit: 0 },
    env: {},
    shouldRepair: false,
  });
  assert.ok(sequence.warningNotes.some((note) => note.includes('missing_backend_url')));
  assert.ok(sequence.warningNotes.some((note) => note.includes('missing_bot_key')));
});

test('botKey secrets contract registers and collects secret refs', () => {
  assert.deepEqual(botChatSecrets.secretTargetRegistryEntries.map((entry) => entry.id), [
    'channels.bot-chat.botKey',
  ]);

  const cfg = {
    channels: {
      'bot-chat': {
        backendUrl: 'http://backend',
        botKey: { source: 'env', provider: 'default', id: 'BOT_CHAT_BOT_KEY' },
      },
    },
  };
  const context = { assignments: [] };
  botChatSecrets.collectRuntimeConfigAssignments({ config: cfg, context });

  assert.equal(context.assignments.length, 1);
  assert.equal(context.assignments[0].path, 'channels.bot-chat.botKey');
  assert.equal(context.assignments[0].expected, 'string');
  context.assignments[0].apply('resolved-secret');
  assert.equal(cfg.channels['bot-chat'].botKey, 'resolved-secret');
});

test('outbound adapter uses parsed BotChat target mapping', async () => {
  const originalRuntime = getBotChatRuntime();
  const sent = [];
  setBotChatRuntime({
    async start() {},
    async stop() {},
    async onInboundMessage() {},
    async sendToChannel(message) {
      sent.push(message);
    },
  });

  try {
    await botChatPlugin.outbound.attachedResults.sendText({
      cfg: { backendUrl: 'http://backend', botKey: 'key', botId: 'bot-a' },
      to: 'dm:alice',
      text: 'hello direct',
    });
    await botChatPlugin.outbound.attachedResults.sendText({
      cfg: { backendUrl: 'http://backend', botKey: 'key', botId: 'bot-a' },
      to: 'channel:conv-1',
      text: 'hello channel',
      metadata: { userId: 'user-a' },
    });
  } finally {
    setBotChatRuntime(originalRuntime);
  }

  assert.deepEqual(sent, [
    {
      channelId: 'chat/dm/user/alice/bot/bot-a',
      userId: 'alice',
      text: 'hello direct',
      metadata: {
        target: 'dm:alice',
        chatType: 'direct',
        botId: 'bot-a',
        toType: 'user',
        publishTopic: 'chat/dm/user/alice/bot/bot-a',
      },
    },
    {
      channelId: 'conv-1',
      userId: 'user-a',
      text: 'hello channel',
      metadata: {
        userId: 'user-a',
        target: 'channel:conv-1',
        chatType: 'channel',
        botId: 'bot-a',
        toType: 'user',
        publishTopic: 'conv-1',
      },
    },
  ]);
});

test('history catchup URL uses bot-runtime endpoint', () => {
  assert.equal(
    buildBotChatHistoryMessagesUrl({
      backendUrl: 'http://backend/',
      conversationId: 'chat/group/group-1',
      afterSeq: 7,
      limit: 10,
    }),
    'http://backend/api/v1/bot-runtime/messages/chat%2Fgroup%2Fgroup-1?limit=10&after_seq=7',
  );
});

test('pairing and allowlist adapters normalize sender ids consistently', async () => {
  assert.equal(botChatPlugin.pairing.text.normalizeAllowEntry('user:alice'), 'alice');
  assert.equal(
    botChatPlugin.allowlist.isAllowed({ cfg: { allowFrom: ['user:alice'] }, userId: 'alice' }),
    true,
  );
  await botChatPlugin.pairing.text.notify({ cfg: {}, id: 'alice', message: 'approved' });
});

test('botChatSetupPlugin keeps setup-capable base surface only', () => {
  assert.equal(botChatSetupPlugin.id, 'bot-chat');
  assert.ok(botChatSetupPlugin.setup);
  assert.ok(botChatSetupPlugin.config);
  assert.equal('gateway' in botChatSetupPlugin, false);
});
