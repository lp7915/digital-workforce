import type { ArkClient, RunResult } from '../ark.ts';
import { runInputFingerprint } from '../pdf-input.ts';
import { Workforce, explicitExtractor, type Job, type Turn, type Candidate } from './domain.ts';

type Extraction = {
  id: string;
  phase: 'creating' | 'ready' | 'dispatched' | 'completed';
  sessionId?: string;
  input: string;
  candidates?: Candidate[];
};
type Port = Pick<ArkClient, 'createSession' | 'run' | 'inspectRun'>;
export class MaExtractor {
  w: Workforce;
  port: Port;
  config: { agentId: string; version: number; environmentId: string };
  constructor(w: Workforce, port: Port, config: { agentId: string; version: number; environmentId: string }) {
    if (
      !config.agentId ||
      !config.environmentId ||
      !Number.isSafeInteger(config.version) ||
      config.version < 1
    )
      throw new Error('后台提炼配置无效');
    this.w = w;
    this.port = port;
    this.config = config;
  }
  async extract(turns: Turn[], job?: Job): Promise<Candidate[]> {
    if (!job || turns.some((t) => t.direct || t.projectId !== job.projectId || !job.sourceIds.includes(t.id)))
      throw new Error('后台任务来源越界');
    // 仅发送明确确认且不含敏感内容的候选证据；不发送其他聊天，不传个人UAT。
    const confirmed = explicitExtractor(turns);
    if (!confirmed.length) return [];
    const input = JSON.stringify({
      task: '从已确认候选中去重、筛选稳定且有项目价值的信息。只输出JSON数组，保持key/value/kind/sourceIds原值，不能新增规则或推测。',
      candidates: confirmed,
    });
    let state = this.w.get<Extraction>('extraction', job.id);
    if (state?.phase === 'completed') return state.candidates!;
    if (state && state.input !== input) throw new Error('已冻结提炼输入发生变化');
    if (state?.phase === 'creating') throw new Error('此前后台Session创建结果未知，禁止重复创建');
    if (!state) {
      state = { id: job.id, phase: 'creating', input };
      this.w.put('extraction', state);
      const sessionId = await this.port.createSession({
        agent: {
          type: 'agent_with_overrides',
          id: this.config.agentId,
          version: this.config.version,
          system: '你是后台记忆候选筛选器。只能输出指定JSON候选，不执行工具，不操作业务Session。',
          tools: [],
          skills: [],
          mcp_servers: [],
        },
        environment_id: this.config.environmentId,
        vault_ids: [],
        tags: [{ key: 'workforce_memory_job', value: job.id }],
      });
      state = { ...state, phase: 'ready', sessionId };
      this.w.put('extraction', state);
    }
    let result: RunResult;
    if (state.phase === 'dispatched') {
      const observation = await this.port.inspectRun(state.sessionId!, runInputFingerprint(input));
      if (observation.status !== 'ended') throw new Error('提炼任务结果尚未确认，禁止重复派发');
      result = observation.result;
    } else {
      state.phase = 'dispatched';
      this.w.put('extraction', state);
      result = await this.port.run(state.sessionId!, input, 120000);
    }
    if (result.terminal !== 'idle' || result.authorizationRequired || !result.messages.length)
      throw new Error('提炼Session没有有效业务结果');
    let candidates: Candidate[];
    try {
      candidates = JSON.parse(
        result.messages
          .join('\n')
          .replace(/^```(?:json)?\s*/, '')
          .replace(/\s*```$/, ''),
      );
    } catch {
      throw new Error('提炼候选JSON无效');
    }
    if (!Array.isArray(candidates) || candidates.length > 50) throw new Error('提炼候选结构无效');
    for (const c of candidates)
      if (!confirmed.some((original) => JSON.stringify(original) === JSON.stringify(c)))
        throw new Error('模型生成了未经确认的候选');
    state.phase = 'completed';
    state.candidates = candidates;
    this.w.put('extraction', state);
    return candidates;
  }
}
