import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workforce, type Job, type Memory } from '../src/workforce/domain.ts';

test('真实子进程在提炼领取后退出，重启恢复同一冻结范围并只提交一次', () => {
  const dir = mkdtempSync(join(tmpdir(), 'workforce-crash-'));
  const path = join(dir, 'workforce.db');
  const moduleUrl = new URL('../src/workforce/domain.ts', import.meta.url).href;
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '-e',
      `
    import { Workforce } from ${JSON.stringify(moduleUrl)};
    let now = 1000;
    const w = new Workforce(${JSON.stringify(path)}, () => now);
    const actor = { id: 'admin', role: 'admin' };
    const e = w.createEmployee(actor, { name: '测试员工' }); w.publish(actor, e.id, 1);
    const p = w.createProject(actor, { name: '项目' });
    w.bind(actor, { employeeId: e.id, projectId: p.id, chatId: 'chat' });
    const t = w.beginTurn({ employeeId: e.id, chatId: 'chat', messageId: 'm', userId: 'u', text: '确认事实：负责人=王工', direct: false });
    w.finishTurn(t.id, 'idle'); const [j] = w.planJobs(); now += 30000; w.claimJob(j.id);
    process.exit(77);
  `,
    ],
    { encoding: 'utf8', timeout: 5000 },
  );
  assert.equal(child.status, 77, child.stderr);
  const w = new Workforce(path, () => 50000);
  try {
    const job = w.all<Job>('job')[0];
    assert.equal(job.state, 'running');
    w.recoverJobs();
    assert.equal(w.claimJob(job.id)?.id, job.id);
    const candidates = [{ key: '负责人', value: '王工', kind: 'fact', sourceIds: job.sourceIds }];
    w.commitJob(job.id, candidates);
    w.commitJob(job.id, candidates);
    assert.equal(w.all<Memory>('memory').length, 1);
  } finally {
    w.close();
    rmSync(dir, { recursive: true });
  }
});
