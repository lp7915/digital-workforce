import { ArkHttpError, LARK_CLI_SETUP_SCRIPT, LARK_CLI_VERSION } from '../ark.ts';
import type { LocalWorkspace } from './workspace.ts';
import type { MaMemoryApi } from './ma-memory.ts';
import { DomainError } from './domain.ts';

export const RECOMMENDED_ENVIRONMENT_NAME = 'workforce-lark-cli-recommended';
export class MaEnvironments {
  private workspace: LocalWorkspace;
  private api: MaMemoryApi;
  private create: () => Promise<{ id: string }>;
  private preparing?: Promise<string>;
  constructor(workspace: LocalWorkspace, api: MaMemoryApi, create: () => Promise<{ id: string }>) {
    this.workspace = workspace;
    this.api = api;
    this.create = create;
    workspace.db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_recommended_environment (id INTEGER PRIMARY KEY, remote_id TEXT)',
    );
  }
  private recommended(e: any) {
    return (
      e.name === RECOMMENDED_ENVIRONMENT_NAME &&
      e.config?.setup_script === LARK_CLI_SETUP_SCRIPT &&
      !e.config?.env?.LARKSUITE_CLI_APP_ID
    );
  }
  async list(appId = '') {
    const rows = await this.api.all('/environments');
    const recommendedId = rows.find((e) => this.recommended(e))?.id || '';
    return {
      recommendedId,
      environments: rows
        .map((e) => {
          const fixedApp = e.config?.env?.LARKSUITE_CLI_APP_ID;
          const startup = e.config?.setup_script === LARK_CLI_SETUP_SCRIPT;
          return {
            id: e.id,
            name: e.name,
            type: e.config?.type || 'unknown',
            recommended: e.id === recommendedId,
            compatible: !fixedApp || fixedApp === appId,
            larkCli: startup ? 'startup' : 'unknown',
            larkCliVersion: startup ? LARK_CLI_VERSION : undefined,
          };
        })
        .sort((a, b) => Number(b.recommended) - Number(a.recommended)),
    };
  }
  ensureRecommended() {
    if (!this.preparing)
      this.preparing = this.prepare().finally(() => {
        this.preparing = undefined;
      });
    return this.preparing;
  }
  private async prepare() {
    const rows = await this.api.all('/environments');
    const found = rows.filter((e) => this.recommended(e));
    if (found.length) {
      this.workspace.db
        .prepare('INSERT OR REPLACE INTO workspace_recommended_environment VALUES(1,?)')
        .run(found[0].id);
      return found[0].id as string;
    }
    const row = this.workspace.db.prepare('SELECT * FROM workspace_recommended_environment WHERE id=1').get();
    if (row) throw new DomainError('推荐环境创建结果未确认或环境已变更，请先核查 MA，未重复创建', 409);
    this.workspace.db.prepare('INSERT INTO workspace_recommended_environment VALUES(1,NULL)').run();
    try {
      const created = await this.create();
      if (!/^env-[\w-]+$/.test(created.id)) throw new DomainError('MA 未返回有效环境 ID', 502);
      this.workspace.db
        .prepare('UPDATE workspace_recommended_environment SET remote_id=? WHERE id=1')
        .run(created.id);
      return created.id;
    } catch (error) {
      if (
        (error instanceof DomainError || error instanceof ArkHttpError) &&
        [400, 401, 403, 422, 429].includes(error.status)
      )
        this.workspace.db
          .prepare('DELETE FROM workspace_recommended_environment WHERE id=1 AND remote_id IS NULL')
          .run();
      throw error;
    }
  }
  async validate(id: string, appId = '') {
    if (typeof id !== 'string' || !/^env-[a-zA-Z0-9_-]{1,120}$/.test(id))
      throw new DomainError('MA 环境 ID 无效');
    const raw = await this.api.call('/environments/' + encodeURIComponent(id));
    const env = raw.data || raw;
    if (!env.config?.type) throw new DomainError('MA 环境配置无效', 502);
    const fixedApp = env.config.env?.LARKSUITE_CLI_APP_ID;
    if (fixedApp && fixedApp !== appId)
      throw new DomainError('该环境已固定绑定其他飞书应用，请选择通用环境或当前员工环境', 409);
    return { id: env.id, name: env.name };
  }
}
