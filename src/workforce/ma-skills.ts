import { DomainError } from './domain.ts';
import type { MaConfiguration } from './ma-config.ts';
import type { LocalWorkspace } from './workspace.ts';

export class MaSkills {
  private config: Pick<MaConfiguration, 'apiKey'>;
  private fetcher: typeof fetch;
  constructor(config: Pick<MaConfiguration, 'apiKey'>, fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }
  private async get(path: string) {
    const key = this.config.apiKey();
    if (!key) throw new DomainError('请先配置方舟 APIKey', 400);
    let response: Response;
    try {
      response = await this.fetcher(`https://ark.cn-beijing.volces.com/api/v3${path}`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new DomainError('读取 MA 技能失败，请检查网络后重试', 502);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new DomainError(
        response.status === 401 || response.status === 403
          ? 'APIKey 无效或没有读取 MA 技能的权限'
          : `读取 MA 技能失败（HTTP ${response.status}）`,
        502,
      );
    }
    try {
      const payload = await response.json();
      if (payload.error) throw new Error();
      return payload;
    } catch {
      throw new DomainError('MA 技能响应格式无效', 502);
    }
  }
  private normalize(item: any) {
    if (
      !item ||
      typeof item.id !== 'string' ||
      !item.id ||
      typeof item.name !== 'string' ||
      !item.name ||
      !/^\d+$/.test(String(item.latest_version ?? '')) ||
      item.source !== 'custom'
    )
      throw new DomainError('MA 技能信息缺失或类型不受支持', 502);
    return {
      id: item.id,
      name: item.name,
      description: typeof item.description === 'string' ? item.description : '',
      tags: typeof item.description === 'string' && item.description.startsWith('[ada]') ? ['ada'] : [],
      version: String(item.latest_version),
      source: 'ma',
      type: 'custom',
      enabled: true,
    };
  }
  async list(page = '') {
    if (page.length > 4096) throw new DomainError('分页参数无效');
    const payload = await this.get(`/skills?limit=100${page ? `&page=${encodeURIComponent(page)}` : ''}`);
    if (!Array.isArray(payload.data) || (payload.has_more && !payload.next_page))
      throw new DomainError('MA 技能列表响应格式无效', 502);
    return {
      skills: payload.data.map((item: any) => this.normalize(item)),
      hasMore: Boolean(payload.has_more),
      nextPage: payload.next_page || '',
    };
  }
  async detail(id: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new DomainError('Skill ID 无效');
    const payload = await this.get(`/skills/${encodeURIComponent(id)}`);
    const skill = this.normalize(payload.data ?? payload);
    if (skill.id !== id) throw new DomainError('MA 返回的 Skill ID 不匹配', 502);
    return skill;
  }
  async bind(workspace: LocalWorkspace, employeeId: string, skillId: string) {
    if (!workspace.read().state.employees.some((e: any) => e.id === employeeId))
      throw new DomainError('员工不存在', 404);
    const skill = await this.detail(skillId);
    const latest = workspace.read();
    const employee = latest.state.employees.find((e: any) => e.id === employeeId);
    if (!employee) throw new DomainError('员工不存在', 404);
    const existing = employee.skills.findIndex((s: any) => s.id === skill.id);
    if (existing < 0) employee.skills.push(skill);
    else employee.skills[existing] = skill;
    return workspace.save(latest.state, latest.revision);
  }
  async references(skills: any[]) {
    const refs = [];
    for (const skill of skills.filter((s) => s.enabled)) {
      if (skill.source !== 'ma' || skill.type !== 'custom')
        throw new DomainError('请从 MA 重新选择技能，不能使用本地模拟技能');
      const current = await this.detail(skill.id);
      if (current.version !== skill.version)
        throw new DomainError(`技能 ${current.name} 已更新，请从 MA 重新选择后连接`);
      refs.push({ type: 'custom', skill_id: current.id, version: current.version });
    }
    return refs;
  }
}

export function migrateLocalSkills(workspace: LocalWorkspace) {
  const current = workspace.read();
  let changed = false;
  for (const employee of current.state.employees) {
    const local = employee.skills.filter((skill: any) => skill.source !== 'ma');
    if (!local.length) continue;
    employee.knowledge = [
      employee.knowledge,
      '本地分析流程（非 MA Skill）：',
      ...local.map(
        (skill: any) =>
          `${skill.name}${skill.enabled ? '' : '（原已停用，仅作历史参考）'}\n${skill.instructions || skill.description || ''}`,
      ),
    ]
      .filter(Boolean)
      .join('\n\n');
    employee.skills = employee.skills.filter((skill: any) => skill.source === 'ma');
    changed = true;
  }
  if (changed) workspace.save(current.state, current.revision);
}
