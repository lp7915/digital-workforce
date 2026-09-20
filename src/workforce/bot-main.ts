import { resolve } from 'node:path';
import { ArkClient } from '../ark.ts';
import { Gateway, type IncomingMessage } from '../gateway.ts';
import { GatewayStore } from '../store.ts';
import { LarkChannelAdapter } from '../lark-channel.ts';
import { EmployeeAuthorizationManager } from '../employee-auth.ts';
import { FeishuOAuth } from '../oauth.ts';
import { startChannelAfterRecovery } from '../channel-startup.ts';
import { Workforce, sessionKey, type Turn } from './domain.ts';
import { WorkforceBridge } from './bridge.ts';
import { readBotConfig } from './bot-config.ts';

const args = process.argv.slice(2);
const configIndex = args.indexOf('--config');
if (
  configIndex < 0 ||
  !args[configIndex + 1] ||
  (!args.includes('--start') && !args.includes('--check')) ||
  args.some((arg, index) => !['--config', '--start', '--check'].includes(arg) && index !== configIndex + 1)
)
  throw new Error('用法：npm run bot -- --config work/test-bot.json --check 或 --start');
const config = readBotConfig(args[configIndex + 1]);
const dataDir = resolve(process.env.WORKFORCE_DATA_DIR || 'data');
const w = new Workforce(resolve(dataDir, 'workforce.db'));
const employee = w.employee(config.employeeId);
const release = w.release(employee.releaseId || '');
if (!release.content.agentId || !/^\d+$/.test(release.content.agentVersion))
  throw new Error('先在 Web 中发布真实 MA Agent ID 和固定数字版本');
const previousIdentity = w.get<any>('bot-identity', employee.id);
if (previousIdentity && previousIdentity.appId !== config.appId)
  throw new Error('员工已绑定其他真实 Bot；首版不允许直接替换访问身份');
if (w.all<any>('bot-identity').some((item) => item.id !== employee.id && item.appId === config.appId))
  throw new Error('此真实 Bot 已关联另一个员工');
if (args.includes('--check')) {
  console.log('本地配置结构、测试范围与发布版本检查通过；没有连接飞书或 MA，外部资源权限尚未验证。');
  w.close();
  process.exit(0);
}

const store = new GatewayStore(resolve(dataDir, `bot-${employee.id}.db`));
store.acquireRuntimeLock();
const appLock = new GatewayStore(
  resolve(dataDir, `application-${config.appId.replace(/[^a-zA-Z0-9_-]/g, '_')}.db`),
);
appLock.acquireRuntimeLock();
const ark = new ArkClient(config.apiKey, config.baseUrl);
const channel = new LarkChannelAdapter({
  appId: config.appId,
  appSecret: config.appSecret,
  onSent: (m, id) => store.recordOutgoing(m, id),
});
const bridge = new WorkforceBridge(w, employee.id);
let gateway: Gateway;
let expiresAt = 0;
let refresh: Promise<void> | undefined;
const ensureBotToken = async () => {
  if (expiresAt - Date.now() > 300000) return;
  if (!refresh)
    refresh = (async () => {
      const credentials = await ark.listCredentials(config.botVaultId);
      if (
        !credentials.some(
          (c) => c.id === config.botTokenCredentialId && c.secretName === 'LARKSUITE_CLI_TENANT_ACCESS_TOKEN',
        )
      )
        throw new Error('独立 Bot Vault 缺少已确认的租户令牌凭据绑定；本入口不会创建应用凭据');
      const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: config.appId, app_secret: config.appSecret }),
        signal: AbortSignal.timeout(30000),
      });
      const payload = (await response.json()) as any;
      if (!response.ok || payload.code || typeof payload.tenant_access_token !== 'string')
        throw new Error('独立测试 Bot 令牌获取失败，请核对配置');
      await ark.updateEnvironmentCredential(
        config.botVaultId,
        config.botTokenCredentialId,
        payload.tenant_access_token,
      );
      expiresAt = Date.now() + Number(payload.expire || 7200) * 1000;
    })().finally(() => {
      refresh = undefined;
    });
  await refresh;
};
const auth = new EmployeeAuthorizationManager(
  store,
  ark,
  new FeishuOAuth(config.appId, config.appSecret),
  async (m, url) =>
    channel.reply(m, {
      type: 'card',
      card: {
        schema: '2.0',
        header: { title: { tag: 'plain_text', content: '授权读取你的个人资料' } },
        body: {
          elements: [
            {
              tag: 'markdown',
              content: '仅当前单聊使用你的授权。个人资料不会进入项目共享记忆。可发送 /auth cancel 取消等待。',
            },
            {
              tag: 'button',
              text: { tag: 'plain_text', content: '继续授权' },
              type: 'primary_filled',
              behaviors: [{ type: 'open_url', default_url: url }],
            },
          ],
        },
      },
    }),
  (m, vault) => gateway.resumeAfterAuthorization(m, vault),
  {
    notify: (m, text) => channel.reply(m, { type: 'text', text }),
    onStateChange: (messages, flow, active) => {
      gateway.setAuthorizationWaiting(messages, flow, active);
      for (const m of messages) w.setWaiting(sessionKey(bridge.input(m)), active);
    },
  },
);
const accessAllowed = (m: IncomingMessage) =>
  m.installationId === config.appId &&
  config.allowedTenantIds.includes(m.tenantId) &&
  (m.conversationType === 'group'
    ? config.allowedChatIds.includes(m.conversationId)
    : config.allowedUserIds.includes(m.senderId));
gateway = new Gateway(store, ark, (m, outbound, observer) => channel.reply(m, outbound, observer), {
  appId: config.appId,
  agentId: release.content.agentId,
  environmentId: config.environmentId,
  vaultId: config.botVaultId,
  timeoutMs: config.timeoutMs,
  platformAccess: true,
  sharedGroupSessions: true,
  pdfInputMode: 'file',
  ...bridge.hooks(),
  buildSessionRequest: async (m, draft) => bridge.sessionRequest(m, draft),
  beforeCreateSession: ensureBotToken,
  downloadAttachment: (resource, m, max) => channel.download(resource, m, max),
  streamReply: (m, producer, observer) => channel.streamReply(m, producer, observer),
  addReaction: (m, emoji) => channel.addReaction(m, emoji),
  removeReaction: (m, id) => channel.removeReaction(m, id),
  loadRecentHistory: (m) => channel.loadRecentHistory(m),
  readMessage: (m, id, signal) => channel.readMessage(m, id, signal),
  dualIdentity: config.enableUserOAuth,
  ensureAuthorization: config.enableUserOAuth ? (m, request) => auth.ensure(m, request) : async () => false,
  cancelAuthorization: (m) => auth.cancel(m),
  authorizationStatus: (m) => auth.status(m),
  getUserVaultIds: (m) =>
    config.enableUserOAuth && m.conversationType === 'direct' ? auth.vaultIds(m) : Promise.resolve([]),
  ...(config.enableUserOAuth
    ? {
        userCredentialLifecycle: {
          revision: 'workforce-user-credentials-v1',
          capture: (m: IncomingMessage) => auth.captureUserTurn(m),
          prepare: (m: IncomingMessage, intent: any) => auth.prepareUserTurn(m, intent),
          recover: async (m: IncomingMessage, intent: any) => {
            if (!auth.matchesUserTurnIntent(m, intent)) throw new Error('用户授权准备意图已变化');
            await ensureBotToken();
            return auth.recoverUserTurn(m, intent);
          },
          matchesIntent: (m: IncomingMessage, intent: any) => auth.matchesUserTurnIntent(m, intent),
          refresh: async (m: IncomingMessage, proof: any) => {
            await ensureBotToken();
            await auth.refreshPreparedAuthorization(m, proof);
          },
          matches: (m: IncomingMessage, proof: any, dispatch?: boolean) =>
            auth.matchesPreparedAuthorization(m, proof, dispatch),
        },
      }
    : {}),
});
let heartbeat: ReturnType<typeof setInterval> | undefined;
let stopping = false;
const status = (state: string) =>
  w.put('runtime', {
    id: employee.id,
    employeeId: employee.id,
    appId: config.appId,
    state,
    heartbeat: Date.now(),
  } as any);
async function stop() {
  if (stopping) return;
  stopping = true;
  if (heartbeat) clearInterval(heartbeat);
  auth.close();
  await channel.stop();
  status('stopped');
  store.close();
  appLock.close();
  w.close();
}
try {
  await gateway.validateConfiguration();
  // 重启后的未知轮次保持待核实，不把未知运行自动当成空闲或重新派发。
  for (const turn of w.all<Turn>('turn').filter((t) => t.employeeId === employee.id && t.state === 'running'))
    w.finishTurn(turn.id, 'waiting', turn.sessionId);
  w.put('bot-identity', { id: employee.id, appId: config.appId, vaultId: config.botVaultId } as any);
  await startChannelAfterRecovery(
    channel,
    () => {
      if (config.enableUserOAuth) auth.restore();
    },
    (m) => {
      if (!accessAllowed(m)) return;
      if (gateway.accept(m)) bridge.queued(m);
    },
  );
  status('running');
  heartbeat = setInterval(() => status('running'), 5000);
  console.log('独立测试 Bot 已连接。仅受理配置白名单；Ctrl+C 停止本实例。项目记忆后台由 Web 服务处理。');
  process.once('SIGINT', () => {
    void stop().then(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void stop().then(() => process.exit(0));
  });
} catch (error) {
  await stop();
  console.error('独立 Bot 启动失败，未启动业务处理；请核查测试资源、配置与契约。');
  process.exitCode = 1;
}
