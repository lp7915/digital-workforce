import { createHash } from 'node:crypto';
import type { IncomingMessage } from '../gateway.ts';
import type { SessionCreateRequest } from '../ark.ts';
import type { LocalWorkspace } from './workspace.ts';
import type { MaMemoryApi } from './ma-memory.ts';
import { employeeConfigurationHash } from './agent-configuration.ts';
import { DomainError } from './domain.ts';

export function memoryScope(
  state: any,
  employeeId: string,
  message: Pick<IncomingMessage, 'conversationId' | 'conversationType'>,
) {
  const employee = state.employees.find((e: any) => e.id === employeeId);
  if (!employee?.enabled) throw new DomainError('员工不存在或已停用', 403);
  const group =
    message.conversationType === 'group'
      ? state.groups.find(
          (g: any) => g.chatId === message.conversationId && g.employeeIds.includes(employeeId),
        )
      : undefined;
  if (message.conversationType === 'group' && !group) throw new DomainError('群聊未关联此员工', 403);
  const project = group?.projectId ? state.projects.find((p: any) => p.id === group.projectId) : undefined;
  const owners = [employee, ...(project ? [project] : [])];
  const stores = owners.flatMap((o: any) => {
    if (o.memoryStores.length && o.memoryMode !== 'ma')
      throw new DomainError('请先在工作台将员工和项目记忆迁移到 MA');
    return o.memoryStores.map((s: any) => {
      if (!/^memstore-[a-zA-Z0-9_-]+$/.test(s.maStoreId || '')) throw new DomainError('记忆库未正确关联 MA');
      return s.maStoreId;
    });
  });
  const storeIds = [...new Set<string>(stores)].sort();
  if (storeIds.length > 10) throw new DomainError('员工与项目合计最多挂载 10 个 MA 记忆库');
  const configurationHash = employeeConfigurationHash(employee);
  const projectId = project?.id || '';
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({ employeeId, projectId, storeIds, configurationHash, chatId: message.conversationId }),
    )
    .digest('hex');
  return { employeeId, projectId, storeIds, fingerprint, configurationHash };
}
export class SessionMemory {
  workspace: LocalWorkspace;
  api: MaMemoryApi;
  constructor(workspace: LocalWorkspace, api: MaMemoryApi) {
    this.workspace = workspace;
    this.api = api;
    workspace.db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_ma_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)',
    );
  }
  build(employeeId: string, message: IncomingMessage, draft: SessionCreateRequest) {
    const scope = memoryScope(this.workspace.read().state, employeeId, message);
    return {
      ...draft,
      resources: [
        ...(draft.resources || []).filter((r) => r.type !== 'memory_store'),
        ...scope.storeIds.map((id) => ({ type: 'memory_store', memory_store_id: id, access: 'read_only' })),
      ],
      tags: [
        ...(draft.tags || []).filter((t) => !t.key.startsWith('workforce_')),
        { key: 'workforce_scope', value: scope.fingerprint },
        { key: 'workforce_project', value: scope.projectId },
        { key: 'workforce_employee', value: employeeId },
      ],
    };
  }
  async validate(employeeId: string, message: IncomingMessage, sessionId: string) {
    const scope = memoryScope(this.workspace.read().state, employeeId, message);
    const row = this.workspace.db
      .prepare('SELECT payload FROM workspace_ma_sessions WHERE id=?')
      .get(sessionId) as any;
    let snapshot = row ? JSON.parse(row.payload) : undefined;
    if (!snapshot) {
      const raw = await this.api.call(`/sessions/${encodeURIComponent(sessionId)}`);
      const session = raw.data || raw;
      const remoteStores = (session.resources || [])
        .filter((r: any) => r.type === 'memory_store')
        .map((r: any) => r.memory_store_id)
        .sort();
      if (
        session.tags?.find((t: any) => t.key === 'workforce_scope')?.value !== scope.fingerprint ||
        JSON.stringify(remoteStores) !== JSON.stringify(scope.storeIds)
      )
        throw new DomainError(
          '此 Session 尚未挂载当前项目记忆，或配置已变化。请发送 /new 创建新 Session；原文件仍保留在旧会话。',
          409,
        );
      snapshot = {
        ...scope,
        id: sessionId,
        chatId: message.conversationId,
        direct: message.conversationType === 'direct',
        createdAt: new Date().toISOString(),
      };
    }
    if (snapshot.fingerprint !== scope.fingerprint)
      throw new DomainError(
        '项目、记忆库关联或员工配置已变化，请发送 /new 后继续，避免使用旧项目上下文。',
        409,
      );
    snapshot.updatedAt = new Date().toISOString();
    this.workspace.db
      .prepare('INSERT OR REPLACE INTO workspace_ma_sessions VALUES (?,?)')
      .run(sessionId, JSON.stringify(snapshot));
  }
  completed(sessionId: string) {
    const row = this.workspace.db
      .prepare('SELECT payload FROM workspace_ma_sessions WHERE id=?')
      .get(sessionId) as any;
    if (!row) return;
    const snapshot = JSON.parse(row.payload);
    snapshot.completedAt = new Date().toISOString();
    this.workspace.db
      .prepare('UPDATE workspace_ma_sessions SET payload=? WHERE id=?')
      .run(JSON.stringify(snapshot), sessionId);
  }
  recent(projectId: string, employeeId: string, days = 7) {
    const threshold = Date.now() - days * 86400000;
    return this.workspace.db
      .prepare('SELECT payload FROM workspace_ma_sessions')
      .all()
      .map((row: any) => JSON.parse(row.payload))
      .filter(
        (s: any) =>
          !s.direct &&
          s.projectId === projectId &&
          s.employeeId === employeeId &&
          Date.parse(s.completedAt) > threshold,
      )
      .sort((a: any, b: any) => b.completedAt.localeCompare(a.completedAt))
      .slice(0, 10);
  }
}
