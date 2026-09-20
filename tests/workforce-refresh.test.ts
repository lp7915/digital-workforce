import test from 'node:test';
import assert from 'node:assert/strict';
import { Workforce, explicitExtractor, type Memory } from '../src/workforce/domain.ts';
import { WorkforceBridge } from '../src/workforce/bridge.ts';
import type { IncomingMessage } from '../src/gateway.ts';

test('原Session的下一轮读取更正版本；删除后旧上下文被服务端阻止', async () => {
  let now = 1000;
  const w = new Workforce(':memory:', () => now);
  const admin = { id: 'admin', role: 'admin' } as const;
  const employee = w.createEmployee(admin, { name: '员工' });
  w.publish(admin, employee.id, 1);
  const project = w.createProject(admin, { name: '项目' });
  w.bind(admin, { employeeId: employee.id, projectId: project.id, chatId: 'chat' });
  const source = w.beginTurn({
    employeeId: employee.id,
    chatId: 'chat',
    userId: 'u',
    messageId: 'source',
    text: '确认决策：日期=周五',
    direct: false,
  });
  w.finishTurn(source.id, 'idle');
  const [job] = w.planJobs();
  now += 30000;
  w.claimJob(job.id);
  w.commitJob(job.id, explicitExtractor([source]));
  const bridge = new WorkforceBridge(w, employee.id);
  const hooks = bridge.hooks();
  const m = (id: string): IncomingMessage => ({
    channelType: 'lark',
    installationId: 'test',
    tenantId: 'tenant',
    eventId: id,
    messageId: id,
    senderId: 'u',
    conversationId: 'chat',
    conversationType: 'group',
    threadId: '',
    rootMessageId: '',
    parentMessageId: '',
    createTime: now,
    text: '何时交付',
    resources: [],
    mentionedBot: true,
  });
  await hooks.beforeBusinessTurn!(m('first'));
  await hooks.prepareBusinessInput!(m('first'), 'same-session', 'task');
  await hooks.observeBusinessResult!(m('first'), 'same-session', { terminal: 'idle', messages: ['周五'] });
  await hooks.afterBusinessTurn!(m('first'), false);
  const memory = w.all<Memory>('memory')[0];
  const corrected = w.editMemory(admin, memory.id, 'correct', { revision: memory.revision, value: '周六' });
  await hooks.beforeBusinessTurn!(m('second'));
  const input = await hooks.prepareBusinessInput!(m('second'), 'same-session', 'task');
  assert.match(input, /周六/);
  await hooks.observeBusinessResult!(m('second'), 'same-session', { terminal: 'idle', messages: ['周六'] });
  await hooks.afterBusinessTurn!(m('second'), false);
  w.editMemory(admin, corrected.id, 'delete', { revision: corrected.revision });
  await hooks.beforeBusinessTurn!(m('third'));
  await assert.rejects(hooks.prepareBusinessInput!(m('third'), 'same-session', 'task'), /待升级/);
  await hooks.afterBusinessTurn!(m('third'), true);
  w.close();
});
