import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { DomainError } from './domain.ts';

// 工作台配置和旧 Gateway 业务数据分别存储；任务只由服务器修改。
type RecordData = Record<string, any>;
function object(value: unknown, label: string): asserts value is RecordData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DomainError(`${label}格式无效`);
}
function text(value: unknown, label: string, max = 500, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || (!optional && !value.trim()) || value.length > max)
    throw new DomainError(`${label}不能为空或超出长度限制`);
}
function records(value: unknown, label: string): RecordData[] {
  if (!Array.isArray(value) || value.length > 2000) throw new DomainError(`${label}必须是列表且不超过2000条`);
  const ids = new Set();
  for (const row of value) {
    object(row, label);
    text(row.id, `${label} ID`, 128);
    if (ids.has(row.id)) throw new DomainError(`${label} ID 重复`);
    ids.add(row.id);
  }
  return value;
}
function validateMemories(owner: RecordData) {
  const stores = records(owner.memoryStores, '记忆库');
  const storeIds = new Set(
    stores.map((store) => {
      text(store.name, '记忆库名称');
      return store.id;
    }),
  );
  const paths = new Set();
  for (const entry of records(owner.memories, '记忆条目')) {
    if (!storeIds.has(entry.storeId)) throw new DomainError('条目所属记忆库不存在');
    text(entry.path, '条目路径');
    if (
      /[\\\x00-\x1f]/.test(entry.path) ||
      entry.path.split('/').some((part: string) => !part || part === '.' || part === '..')
    )
      throw new DomainError('条目路径必须是有效的库内相对路径');
    const key = JSON.stringify([entry.storeId, entry.path]);
    if (paths.has(key)) throw new DomainError('同一记忆库内条目路径不能重复');
    paths.add(key);
    text(entry.content, '记忆内容', 30000);
    text(entry.title, '条目标题', 500, true);
    text(entry.source, '条目来源', 500, true);
  }
}
function validateConfiguration(employee: RecordData) {
  text(employee.name, '员工名称');
  if (typeof employee.enabled !== 'boolean') throw new DomainError('员工状态无效');
  for (const name of ['identity', 'knowledge', 'rules', 'description'])
    text(employee[name], name, 30000, true);
  object(employee.environment, '环境');
  if (
    employee.environment.maEnvironmentId !== undefined &&
    !/^env-[a-zA-Z0-9_-]{1,120}$/.test(employee.environment.maEnvironmentId)
  )
    throw new DomainError('MA 环境 ID 无效');
  for (const name of ['name', 'model', 'region']) text(employee.environment[name], '环境字段', 500, true);
  if (
    !Number.isInteger(employee.environment.timeout) ||
    employee.environment.timeout < 30 ||
    employee.environment.timeout > 3600
  )
    throw new DomainError('运行超时须为30至3600秒');
  object(employee.channels, '渠道');
  for (const [channel, id] of [
    ['feishu', 'appId'],
    ['doubao', 'agentId'],
  ]) {
    const configuration = employee.channels[channel];
    object(configuration, '渠道配置');
    if (typeof configuration.enabled !== 'boolean') throw new DomainError('渠道状态无效');
    text(configuration[id], '渠道标识', 500, !configuration.enabled);
  }
  for (const skill of records(employee.skills, '技能')) {
    text(skill.name, '技能名称');
    text(skill.instructions, '技能执行说明', 30000, true);
    if (typeof skill.enabled !== 'boolean') throw new DomainError('技能状态无效');
  }
  for (const credential of records(employee.credentials, '凭证')) {
    text(credential.name, '凭证名称');
    if (
      typeof credential.reference !== 'string' ||
      !/^(credential|vault):\/\/[a-zA-Z0-9/_-]+$/.test(credential.reference)
    )
      throw new DomainError('仅支持凭证引用，不接收明文密钥');
  }
}
function validateState(value: unknown, previous: RecordData, memoryWrite = false) {
  object(value, '工作台');
  const input = normalizeGroups(structuredClone(value));
  for (const kind of ['employees', 'projects']) {
    for (const owner of records(input[kind], kind)) {
      const old = previous[kind]?.find((o: RecordData) => o.id === owner.id);
      if (!memoryWrite) {
        if (old?.memoryMode === 'ma' || old?.memoryMigration) {
          owner.memoryStores = structuredClone(old.memoryStores);
          owner.memories = structuredClone(old.memories);
          owner.memoryMode = old.memoryMode;
          owner.memoryMigration = old.memoryMigration;
        } else {
          delete owner.memoryMode;
          delete owner.memoryMigration;
          if (owner.memoryStores?.some((s: RecordData) => s.maStoreId))
            throw new DomainError('MA 记忆库必须通过记忆接口创建');
        }
      }
    }
  }
  const employees = records(input.employees, '数字员工');
  const employeeIds = new Set(employees.map((employee) => employee.id));
  for (const employee of employees) {
    validateConfiguration(employee);
    validateMemories(employee);
    const versions = records(employee.versions, '版本');
    const numbers = new Set();
    for (const version of versions) {
      if (!Number.isInteger(version.number) || version.number < 1 || numbers.has(version.number))
        throw new DomainError('版本编号无效或重复');
      numbers.add(version.number);
      object(version.snapshot, '版本快照');
      validateConfiguration(version.snapshot);
      if (
        version.snapshot.id !== employee.id ||
        'memories' in version.snapshot ||
        'memoryStores' in version.snapshot
      )
        throw new DomainError('版本快照不能包含记忆或其他员工');
    }
    if (employee.activeVersion !== null && !versions.some((version) => version.id === employee.activeVersion))
      throw new DomainError('激活版本不存在');
    const old = previous.employees?.find((item: RecordData) => item.id === employee.id);
    for (const version of old?.versions || []) {
      if (JSON.stringify(versions.find((item) => item.id === version.id)) !== JSON.stringify(version))
        throw new DomainError('已发布版本不可修改或删除');
    }
  }
  const projects = records(input.projects, '项目');
  const allChats = new Set();
  for (const project of projects) {
    text(project.name, '项目名称');
    for (const assignment of records(project.employees, '项目数字员工')) {
      if (!employeeIds.has(assignment.id)) throw new DomainError('项目数字员工不存在');
      text(assignment.role, '项目职责', 2000, true);
      if (!['read', 'write'].includes(assignment.permission)) throw new DomainError('员工记忆权限无效');
    }
    validateMemories(project);
    const members = records(project.members, '项目成员');
    if (!members.some((member) => member.permission === 'manage'))
      throw new DomainError('项目至少保留一位管理成员');
    const accounts = new Set();
    for (const member of members) {
      text(member.name, '成员名称');
      text(member.account, '成员账号');
      if (!['read', 'write', 'manage'].includes(member.permission)) throw new DomainError('成员权限无效');
      if (accounts.has(member.account)) throw new DomainError('项目成员账号重复');
      accounts.add(member.account);
    }
    for (const group of records(project.groups, '项目群聊')) {
      text(group.name, '群聊名称');
      text(group.chatId, '群聊 ID');
      if (allChats.has(group.chatId)) throw new DomainError('群聊只能关联一个项目');
      allChats.add(group.chatId);
    }
  }
  const groups = records(input.groups, '群聊');
  const chats = new Set();
  for (const group of groups) {
    text(group.name, '群聊名称');
    text(group.chatId, '群聊 ID');
    if (chats.has(group.chatId)) throw new DomainError('群聊 ID 已登记');
    chats.add(group.chatId);
    if (group.projectId && !projects.some((project) => project.id === group.projectId))
      throw new DomainError('群聊关联的项目不存在');
    if (
      !Array.isArray(group.employeeIds) ||
      new Set(group.employeeIds).size !== group.employeeIds.length ||
      group.employeeIds.some((id: string) => !employeeIds.has(id))
    )
      throw new DomainError('群聊关联的员工无效或重复');
  }
  return { employees, projects, groups, observations: [] };
}

export function normalizeGroups(state: RecordData): RecordData {
  if (!Array.isArray(state.projects)) return state;
  records(state.projects, '项目');
  if (state.groups === undefined)
    for (const project of state.projects) records(project.groups || [], '项目群聊');
  if (state.groups === undefined)
    state.groups = state.projects.flatMap((project: RecordData) =>
      (project.groups || []).map((group: RecordData) => ({
        ...group,
        id: `${project.id}:${group.id}`,
        projectId: project.id,
        employeeIds: group.employeeIds || (group.employeeId ? [group.employeeId] : []),
        source: 'project',
      })),
    );
  if (Array.isArray(state.groups))
    for (const project of state.projects)
      project.groups = state.groups
        .filter((group: RecordData) => group?.projectId === project.id)
        .map((group: RecordData) => ({ ...group, employeeId: group.employeeIds?.[0] || '' }));
  for (const project of state.projects)
    project.employees ??= [
      ...new Set<string>((project.groups || []).flatMap((g: RecordData) => g.employeeIds || [])),
    ].map((id) => ({ id, role: '', permission: 'write' }));
  return state;
}

export class LocalWorkspace {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS workspace_tasks (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, payload TEXT NOT NULL);`);
    // 本地快照任务没有外部副作用，可在进程恢复后重新执行。
    for (const task of this.tasks())
      if (task.status === 'running' && task.type === 'run') {
        task.status = 'queued';
        task.progress = '服务重启，等待恢复';
        this.putTask(task);
      }
  }
  read() {
    const row = this.db.prepare('SELECT revision, payload FROM workspace WHERE id=1').get() as
      | { revision: number; payload: string }
      | undefined;
    return {
      revision: row?.revision || 0,
      initialized: !!row,
      mode: 'local',
      state: {
        ...normalizeGroups(row ? JSON.parse(row.payload) : { employees: [], projects: [], observations: [] }),
        tasks: this.tasks(),
      },
    };
  }
  save(input: unknown, revision: number, memoryWrite = false) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.read();
      if (!Number.isInteger(revision) || current.revision !== revision)
        throw new DomainError('数据已被其他页面修改，请刷新后重试', 409);
      const state = validateState(input, current.state, memoryWrite);
      this.db
        .prepare(
          'INSERT INTO workspace VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload',
        )
        .run(revision + 1, JSON.stringify(state));
      this.db.exec('COMMIT');
      return this.read();
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  tasks(): RecordData[] {
    return this.db
      .prepare('SELECT payload FROM workspace_tasks ORDER BY rowid DESC')
      .all()
      .map((row) => JSON.parse(String(row.payload)));
  }
  putTask(task: RecordData) {
    this.db
      .prepare(
        'INSERT INTO workspace_tasks VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload',
      )
      .run(task.id, task.requestId, JSON.stringify(task));
  }
  enqueue(input: unknown) {
    object(input, '任务');
    text(input.requestId, '请求标识', 128);
    text(input.name, '任务名称');
    const existing = this.tasks().find((task) => task.requestId === input.requestId);
    if (existing) {
      if (
        existing.employeeId !== input.employeeId ||
        existing.projectId !== (input.projectId || '') ||
        existing.name !== input.name
      )
        throw new DomainError('请求标识已用于其他任务', 409);
      return existing;
    }
    const { state, revision } = this.read();
    const employee = state.employees.find((item: RecordData) => item.id === input.employeeId);
    if (!employee) throw new DomainError('员工不存在', 404);
    if (!employee.enabled) throw new DomainError('员工已停用');
    const project = state.projects.find((item: RecordData) => item.id === input.projectId);
    if (input.projectId && !project) throw new DomainError('项目不存在', 404);
    if (this.tasks().filter((task) => ['queued', 'running'].includes(task.status)).length >= 50)
      throw new DomainError('本地任务队列已满', 429);
    const version = employee.versions.find((item: RecordData) => item.id === employee.activeVersion);
    const task = {
      id: randomUUID(),
      requestId: input.requestId,
      name: input.name,
      type: 'run',
      status: 'queued',
      employeeId: employee.id,
      projectId: project?.id || '',
      progress: '等待本地执行',
      detail: '生成员工配置及项目记忆的上下文快照；不调用模型、不发送群消息。',
      steps: ['已完成 · 接收任务', '等待中 · 组装上下文', '待执行 · 生成快照'],
      createdAt: new Date().toISOString(),
      revision,
      configuration: structuredClone(version?.snapshot || employee),
      configurationVersion: version?.number || '当前草稿',
      memories: structuredClone([
        ...employee.memories.map((entry: RecordData) => ({ ...entry, scope: '员工' })),
        ...(project?.memories || []).map((entry: RecordData) => ({ ...entry, scope: '项目' })),
      ]),
      result: '',
    };
    // 身份、知识、规则使用配置快照；记忆另按当前作用域挂载。
    delete task.configuration.credentials;
    delete task.configuration.versions;
    delete task.configuration.memories;
    this.putTask(task);
    return task;
  }
  cancel(id: string) {
    const task = this.tasks().find((item) => item.id === id);
    if (!task) throw new DomainError('任务不存在', 404);
    if (!['queued', 'running'].includes(task.status)) throw new DomainError('任务已经结束', 409);
    task.status = 'cancelled';
    task.progress = '已取消';
    task.finishedAt = new Date().toISOString();
    this.putTask(task);
    return task;
  }
  tick() {
    const task = this.tasks()
      .reverse()
      .find((item) => item.type === 'run' && ['queued', 'running'].includes(item.status));
    if (!task) return;
    if (task.status === 'queued') {
      task.status = 'running';
      task.startedAt = new Date().toISOString();
      task.progress = '正在组装员工配置与项目记忆';
      task.steps = ['已完成 · 接收任务', '进行中 · 组装上下文', '待执行 · 生成快照'];
    } else {
      task.result = [
        `# ${task.name}`,
        `本地上下文快照（未调用 MA）`,
        `配置修订：${task.revision}；员工版本：${task.configurationVersion}`,
        `员工：${task.configuration.name}`,
        `项目 ID：${task.projectId || '无'}`,
        ...['identity', 'knowledge', 'rules'].map(
          (key) =>
            `\n## ${{ identity: '身份', knowledge: '知识', rules: '规则' }[key]}\n${task.configuration[key] || '未配置'}`,
        ),
        '\n## 挂载记忆',
        ...task.memories.map(
          (entry: RecordData) => `\n### ${entry.scope} / ${entry.storeId} / ${entry.path}\n${entry.content}`,
        ),
      ].join('\n');
      task.status = 'completed';
      task.progress = '上下文快照已生成';
      task.finishedAt = new Date().toISOString();
      task.steps = ['已完成 · 接收任务', '已完成 · 挂载作用域内记忆', '已完成 · 生成快照'];
    }
    this.putTask(task);
  }
  close() {
    this.db.close();
  }
}
