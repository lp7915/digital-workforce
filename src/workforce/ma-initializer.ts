import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { ArkClient } from '../ark.ts';
import { DomainError } from './domain.ts';
import { MaMemoryApi } from './ma-memory.ts';
import { MaSkills } from './ma-skills.ts';
import { PLATFORM_SKILLS } from './skill-catalog.ts';
import { employeeAgentConfiguration, employeeConfigurationHash } from './agent-configuration.ts';
import { RECOMMENDED_ENVIRONMENT_NAME } from './ma-environments.ts';
import type { LocalWorkspace } from './workspace.ts';
import type { MaConfiguration } from './ma-config.ts';
import type { WorkspaceChannels } from './channels.ts';
import type { WorkspaceMemories } from './workspace-memories.ts';

export const ADA_SKILL_NAMES = ['ada-artist-profile', 'ada-brand-fit', 'ada-campaign-review'];

// 每个 Key 独立保存创建回执；网络超时保留 pending，不通过重复 POST 猜测结果。
export class MaResourceRegistry {
  constructor(workspace: LocalWorkspace, scope: string, api: Pick<MaMemoryApi, 'call'>) {
    this.workspace = workspace;
    this.scope = scope;
    this.api = api;
    workspace.db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_ma_resources (scope TEXT, name TEXT, payload TEXT NOT NULL, PRIMARY KEY(scope,name))',
    );
  }
  private workspace: LocalWorkspace;
  private scope: string;
  private api: Pick<MaMemoryApi, 'call'>;
  async ensure(name: string, path: string, known: string | undefined, create: () => Promise<any>) {
    const row = this.workspace.db
      .prepare('SELECT payload FROM workspace_ma_resources WHERE scope=? AND name=?')
      .get(this.scope, name);
    const saved = row ? JSON.parse(String(row.payload)) : undefined;
    const save = (value: any) =>
      this.workspace.db
        .prepare('INSERT OR REPLACE INTO workspace_ma_resources VALUES(?,?,?)')
        .run(this.scope, name, JSON.stringify(value));
    if (saved?.pending) throw new DomainError(`${name} 上次创建结果未确认，请核查 MA，未重复创建`, 409);
    const id = saved?.id || known;
    if (id) {
      try {
        const raw = await this.api.call(`${path}/${encodeURIComponent(id)}`);
        const found = raw.data || raw;
        if (found.id !== id) throw new DomainError(`${name} 返回的资源 ID 不匹配`, 502);
        save({ id });
        return { resource: found, created: false };
      } catch (error) {
        if (!(error instanceof DomainError && error.status === 404)) throw error;
      }
    }
    save({ pending: true });
    try {
      const raw = await create();
      const resource = raw.data || raw;
      if (!resource.id) throw new DomainError(`${name} 创建回执缺少 ID`, 502);
      save({ id: resource.id });
      return { resource, created: true };
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'status' in error &&
        [400, 401, 403, 404, 422, 429].includes(Number(error.status))
      )
        this.workspace.db
          .prepare('DELETE FROM workspace_ma_resources WHERE scope=? AND name=?')
          .run(this.scope, name);
      throw error;
    }
  }
}

export class MaInitializer {
  running = false;
  private workspace: LocalWorkspace;
  private config: MaConfiguration;
  private channels: WorkspaceChannels;
  private memories: WorkspaceMemories;
  constructor(
    workspace: LocalWorkspace,
    config: MaConfiguration,
    channels: WorkspaceChannels,
    memories: WorkspaceMemories,
  ) {
    this.workspace = workspace;
    this.config = config;
    this.channels = channels;
    this.memories = memories;
    for (const task of workspace.tasks())
      if (task.type === 'ma_init' && task.status === 'running') {
        task.status = 'failed';
        task.progress = '服务重启，请重新核验资源';
        workspace.putTask(task);
      }
  }
  status() {
    return { running: this.running, task: this.workspace.tasks().find((t) => t.type === 'ma_init') || null };
  }
  start() {
    if (this.running) return this.status();
    const key = this.config.apiKey();
    if (!key) throw new DomainError('请先保存方舟 API Key');
    if (
      this.workspace
        .tasks()
        .some(
          (t) => ['memory', 'memory_schedule'].includes(t.type) && ['running', 'queued'].includes(t.status),
        )
    )
      throw new DomainError('请等待当前记忆整理任务结束后再初始化', 409);
    this.running = true;
    const job: any = {
      id: randomUUID(),
      requestId: randomUUID(),
      type: 'ma_init',
      name: '初始化 MA 配套资源',
      status: 'running',
      createdAt: new Date().toISOString(),
      progress: '验证当前账户',
      steps: [],
      warnings: [],
    };
    this.workspace.putTask(job);
    void this.run(key, job)
      .catch((error) => {
        job.status = 'failed';
        job.progress = error instanceof DomainError ? error.message : '初始化未完成，请核查 MA 资源后重试';
      })
      .finally(() => {
        this.running = false;
        job.finishedAt = new Date().toISOString();
        this.workspace.putTask(job);
      });
    return this.status();
  }
  private async run(key: string, job: any) {
    const guarded = {
      apiKey: () => {
        if (this.config.apiKey() !== key) throw new DomainError('API Key 已变化，停止初始化', 409);
        return key;
      },
    };
    const api = new MaMemoryApi(guarded),
      ark = new ArkClient(key, 'https://ark.cn-beijing.volces.com/api/v3');
    const availableEnvironments = await api.all('/environments');
    await this.channels.pauseForInitialization();
    job.warnings.push('初始化后请重启本机服务，并在飞书发送 /new 使用新资源。');
    const registry = new MaResourceRegistry(
      this.workspace,
      createHash('sha256').update(key).digest('hex'),
      api,
    );
    const note = (text: string) => {
      job.progress = text;
      job.steps.push(text);
      this.workspace.putTask(job);
    };
    const catalog = this.config.platformSkills() || PLATFORM_SKILLS;
    const skills: any[] = [];
    for (const [index, name] of ADA_SKILL_NAMES.entries()) {
      const known =
        catalog.find((s: any) => s.name === name)?.id ||
        this.workspace
          .read()
          .state.employees.flatMap((e: any) => e.skills)
          .find((s: any) => s.name === name)?.id ||
        catalog[index]?.id;
      const result = await registry.ensure(`skill:${name}`, '/skills', known, () =>
        this.uploadSkill(name, key),
      );
      const skill = result.resource;
      if (skill.name !== name || skill.source !== 'custom' || !/^\d+$/.test(String(skill.latest_version)))
        throw new DomainError(`技能 ${name} 的名称或版本不匹配`, 502);
      skills.push({
        id: skill.id,
        name,
        description: skill.description || '',
        version: String(skill.latest_version),
        source: 'ma',
        type: 'custom',
        enabled: true,
        tags: ['ada'],
      });
      note(`${result.created ? '已创建' : '已复用'} Skill：${name}`);
    }
    guarded.apiKey();
    this.config.savePlatformSkills(skills.map((s) => ({ id: s.id, name: s.name, tags: s.tags })));
    let current = this.workspace.read();
    for (const e of current.state.employees) {
      e.skills = e.skills.map((old: any) => {
        const index = PLATFORM_SKILLS.findIndex((s) => s.id === old.id);
        const replacement =
          skills.find((s) => s.name === old.name) || (index >= 0 ? skills[index] : undefined);
        return replacement ? { ...replacement, enabled: old.enabled } : old;
      });
      if (e.templateId === 'ada-artist-analysis-v1' && !e.skills.length) e.skills = structuredClone(skills);
    }
    this.workspace.save(current.state, current.revision, true);
    const knownEnv = this.workspace.db
      .prepare('SELECT remote_id FROM workspace_recommended_environment WHERE id=1')
      .get()?.remote_id;
    const env = await registry.ensure(
      'recommended-environment',
      '/environments',
      typeof knownEnv === 'string'
        ? knownEnv
        : availableEnvironments.find((e: any) => e.name === RECOMMENDED_ENVIRONMENT_NAME)?.id,
      () => ark.createEnvironment(RECOMMENDED_ENVIRONMENT_NAME, ''),
    );
    this.workspace.db
      .prepare('INSERT OR REPLACE INTO workspace_recommended_environment VALUES(1,?)')
      .run(env.resource.id);
    note(`${env.created ? '已创建' : '已复用'}推荐环境`);
    for (const kind of ['employees', 'projects'])
      for (const owner of this.workspace.read().state[kind]) {
        if (owner.memoryMode !== 'ma') await this.memories.migrate(kind, owner.id);
        for (const store of this.memories.owner(kind, owner.id).memoryStores) {
          const result = await registry.ensure(
            `memory:${kind}:${owner.id}:${store.id}`,
            '/memory_stores',
            store.maStoreId,
            () =>
              api.createStore(store.name, store.description || '', {
                workforce_owner: kind,
                workforce_owner_id: owner.id,
              }),
          );
          if (result.created)
            job.warnings.push(
              `${owner.name} / ${store.name}：已创建空库。旧 MA 正文未在本地备份，无法自动恢复。`,
            );
          current = this.workspace.read();
          const target = current.state[kind]
            .find((o: any) => o.id === owner.id)
            .memoryStores.find((s: any) => s.id === store.id);
          target.maStoreId = result.resource.id;
          target.memoryCount = result.created ? 0 : (result.resource.memory_count ?? target.memoryCount);
          this.workspace.save(current.state, current.revision, true);
          this.workspace.db
            .prepare('INSERT OR REPLACE INTO workspace_memory_links VALUES(?,?,?)')
            .run(JSON.stringify([kind, owner.id, store.id]), result.resource.id, randomUUID());
          note(`${result.created ? '已创建' : '已复用'}记忆库：${owner.name} / ${store.name}`);
        }
      }
    for (const employee of this.workspace.read().state.employees.filter((e: any) => e.enabled)) {
      const binding: any = this.channels.resourceBindings().find((b) => b.employeeId === employee.id) || {
        employeeId: employee.id,
      };
      if (
        binding.pendingResource &&
        ['agentSync', 'agentUpgrade'].includes(binding.pendingResource) &&
        binding.agentId
      ) {
        try {
          await api.call(`/agents/${encodeURIComponent(binding.agentId)}`);
        } catch (error) {
          if (!(error instanceof DomainError && error.status === 404)) throw error;
          binding.agentId = undefined;
          binding.pendingResource = undefined;
          this.channels.saveResourceBinding(binding);
        }
      }
      if (binding.pendingResource)
        throw new DomainError(`${employee.name} 存在未确认的资源操作，请先核查`, 409);
      let environmentId = employee.environment.maEnvironmentId || binding.environmentId || env.resource.id;
      try {
        await api.call(`/environments/${encodeURIComponent(environmentId)}`);
      } catch (error) {
        if (!(error instanceof DomainError && error.status === 404)) throw error;
        environmentId = env.resource.id;
      }
      current = this.workspace.read();
      const e = current.state.employees.find((e: any) => e.id === employee.id);
      e.environment.maEnvironmentId = environmentId;
      this.workspace.save(current.state, current.revision, true);
      const config = employeeAgentConfiguration(e, await new MaSkills(this.config).references(e.skills));
      const agent = await registry.ensure(`agent:${e.id}`, '/agents', binding.agentId, () =>
        ark.createAgent(config),
      );
      if (!agent.created && binding.configurationHash !== employeeConfigurationHash(e)) {
        binding.pendingResource = 'agentSync';
        this.channels.saveResourceBinding(binding);
        const updated = await ark.updateAgent(agent.resource.id, String(agent.resource.version), config);
        binding.agentVersion = updated.version;
        binding.pendingResource = undefined;
      }
      binding.agentId = agent.resource.id;
      binding.configurationHash = employeeConfigurationHash(e);
      binding.environmentId = environmentId;
      this.channels.saveResourceBinding(binding);
      const vault = await registry.ensure(`vault:${e.id}`, '/vaults', binding.vaultId, async () => ({
        id: await ark.createVault(`bf-${e.id}`, { workforce_employee: e.id }),
      }));
      binding.vaultId = vault.resource.id;
      this.channels.saveResourceBinding(binding);
      if (binding.appId && binding.appSecret) {
        const found = (await ark.listCredentials(binding.vaultId)).find(
          (c) => c.secretName === 'LARKSUITE_CLI_APP_SECRET',
        );
        const credential = await registry.ensure(
          `credential:${e.id}:${binding.vaultId}`,
          `/vaults/${binding.vaultId}/credentials`,
          found?.id,
          async () => ({
            id: await ark.createEnvironmentVariableCredential(
              binding.vaultId,
              'lark-cli-bot-app-secret',
              'LARKSUITE_CLI_APP_SECRET',
              binding.appSecret,
            ),
          }),
        );
        binding.credentialId = credential.resource.id;
      }
      binding.status = 'stopped';
      binding.message = 'MA 资源初始化完成，请重启服务';
      binding.runtimeVersion = 2;
      this.channels.saveResourceBinding(binding);
      note(`已初始化数字员工：${employee.name}`);
    }
    if (this.channels.organizer) {
      await this.channels.organizer.initializeResource();
      note('已核验记忆整理 Agent');
    }
    job.status = 'completed';
    job.progress = 'MA 配套资源初始化完成';
    job.result = [...job.steps, ...job.warnings].join('\n');
  }
  private async uploadSkill(name: string, key: string) {
    const directory = mkdtempSync(join(tmpdir(), 'bf-skill-'));
    try {
      const zip = join(directory, `${name}.zip`);
      execFileSync('zip', ['-q', '-r', zip, name], { cwd: resolve('skills') });
      const body = new FormData();
      body.set('files', new Blob([readFileSync(zip)], { type: 'application/zip' }), `${name}.zip`);
      const response = await fetch('https://ark.cn-beijing.volces.com/api/v3/skills', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new DomainError(`Skill 上传失败（HTTP ${response.status}）`, response.status);
      const raw = await response.json();
      const uploaded = raw.data || raw;
      return await new MaMemoryApi({ apiKey: () => key }).call(`/skills/${encodeURIComponent(uploaded.id)}`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
