import test from 'node:test';
import assert from 'node:assert/strict';
import { Workforce, explicitExtractor } from '../src/workforce/domain.ts';
import { MaExtractor } from '../src/workforce/extractor.ts';
test('独立提炼Session不挂载Vault/工具，结果丢失后只读核查且不重复派发', async () => {
  let now = 1;
  const w = new Workforce(':memory:', () => now);
  const actor = { id: 'a', role: 'admin' } as const;
  const e = w.createEmployee(actor, { name: '员工' });
  w.publish(actor, e.id, 1);
  const p = w.createProject(actor, { name: '项目' });
  w.bind(actor, { employeeId: e.id, projectId: p.id, chatId: 'a' });
  const t = w.beginTurn({
    employeeId: e.id,
    chatId: 'a',
    messageId: 'm',
    userId: 'u',
    text: '确认事实：日期=周五',
    direct: false,
  });
  w.finishTurn(t.id, 'idle');
  const [job] = w.planJobs();
  now += 30000;
  w.claimJob(job.id);
  let creates = 0,
    runs = 0;
  const extractor = new MaExtractor(
    w,
    {
      createSession: async (request) => {
        creates++;
        assert.deepEqual(request.vault_ids, []);
        assert.deepEqual((request.agent as any).tools, []);
        return 'background-only';
      },
      run: async () => {
        runs++;
        throw new Error('回包丢失');
      },
      inspectRun: async () => ({
        status: 'ended',
        anchorEventId: 'a',
        terminalEventId: 'b',
        result: { terminal: 'idle', messages: [JSON.stringify(explicitExtractor([t]))] },
      }),
    },
    { agentId: 'extractor-agent', version: 1, environmentId: 'dedicated-env' },
  );
  await assert.rejects(extractor.extract([t], job), /丢失/);
  const candidates = await extractor.extract([t], job);
  w.commitJob(job.id, candidates);
  assert.equal(creates, 1);
  assert.equal(runs, 1);
  assert.equal(w.all('memory').length, 1);
  w.close();
});
