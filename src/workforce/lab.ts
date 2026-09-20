import { Gateway, type IncomingMessage } from '../gateway.ts';
import { GatewayStore } from '../store.ts';
import { WorkforceBridge } from './bridge.ts';
import { Workforce, DomainError, type Principal } from './domain.ts';
import { randomUUID } from 'node:crypto';

export class LocalLab {
  w: Workforce;
  private gateways = new Map<string, { gateway: Gateway; bridge: WorkforceBridge; store: GatewayStore }>();
  private pending = new Map<
    string,
    { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(w: Workforce) {
    this.w = w;
  }
  close() {
    for (const value of this.gateways.values()) value.store.close();
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ error: '本地验收服务已停止' });
    }
  }
  async chat(
    actor: Principal,
    input: { employeeId: string; chatId: string; threadId?: string; text: string },
  ) {
    if (
      !input ||
      typeof input.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > 10000 ||
      typeof input.chatId !== 'string' ||
      input.chatId.length > 200 ||
      (input.threadId !== undefined && (typeof input.threadId !== 'string' || input.threadId.length > 200))
    )
      throw new DomainError('验收消息参数无效');
    const binding = this.w.binding(input.employeeId, input.chatId);
    if (!binding?.active) throw new DomainError('本地验收请选择已绑定的群');
    this.w.manage(actor, binding.projectId);
    let runtime = this.gateways.get(input.employeeId);
    if (!runtime) {
      const store = new GatewayStore(':memory:');
      const bridge = new WorkforceBridge(this.w, input.employeeId);
      const gateway = new Gateway(
        store,
        {
          createSession: async () => `local-simulation-${randomUUID()}`,
          run: async (_sessionId, text, _timeout, _progress, onText) => {
            const raw = text.match(/<gateway_context>\n([^]*?)\n<\/gateway_context>/)?.[1];
            const context = raw ? JSON.parse(raw) : {};
            const memories = context.current_authorized_memory || [];
            const result = `【本地适配器验收 · 未调用 MA / 飞书】\n发布版本：${context.gateway_release}\n项目记忆修订：${context.memory_revision}\n${memories.length ? memories.map((m: any) => `${m.key}：${m.value}\n来源轮次：${m.sourceIds.join(', ')}`).join('\n') : '当前没有可读取的项目记忆。'}\n\n本轮仅检验真实 Gateway 的版本、路由与权限。确认类消息会在连续空闲 30 秒后进入后台提炼。`;
            await onText?.(result);
            return { terminal: 'idle', messages: [result] };
          },
        },
        async (m, outbound) => {
          const p = this.pending.get(m.messageId);
          if (p) {
            clearTimeout(p.timer);
            this.pending.delete(m.messageId);
            p.resolve({
              text: outbound.type === 'text' ? outbound.text : '非文本回复',
              mode: 'local-adapter',
            });
          }
        },
        {
          agentId: 'local-contract-agent',
          environmentId: 'local-env',
          vaultId: 'local-vault',
          platformAccess: true,
          sharedGroupSessions: true,
          timeoutMs: 5000,
          ...bridge.hooks(),
        },
      );
      runtime = { gateway, bridge, store };
      this.gateways.set(input.employeeId, runtime);
    }
    const id = randomUUID();
    const m: IncomingMessage = {
      channelType: 'lark',
      installationId: 'local-lab',
      tenantId: 'local',
      eventId: id,
      messageId: id,
      conversationId: input.chatId,
      conversationType: 'group',
      threadId: input.threadId || '',
      rootMessageId: '',
      parentMessageId: '',
      senderId: actor.id,
      createTime: Date.now(),
      text: input.text,
      resources: [],
      mentionedBot: true,
    };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ error: '本地队列等待超时' });
      }, 15000);
      this.pending.set(id, { resolve, timer });
      if (runtime!.gateway.accept(m)) runtime!.bridge.queued(m);
      else {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ error: '消息未受理' });
      }
    });
  }
}
