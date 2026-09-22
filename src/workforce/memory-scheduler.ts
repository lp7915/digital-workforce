import { createHash } from 'node:crypto';
import type { LocalWorkspace } from './workspace.ts';
import type { MemoryOrganizer } from './memory-organizer.ts';
import type { SessionMemory } from './session-memory.ts';

const DAY = 86400000;
const OFFSET = 8 * 3600000;
export const midnightAfter = (now: number) => (Math.floor((now + OFFSET) / DAY) + 1) * DAY - OFFSET;
const dateKey = (now: number) => new Date(now + OFFSET).toISOString().slice(0, 10);
type Item = {
  projectId: string;
  employeeId: string;
  storeId: string;
  requestId: string;
  status: string;
  taskId?: string;
  error?: string;
};
type Schedule = { nextAt: number; batch?: { date: string; id: string; items: Item[]; finished?: boolean } };

// 服务级单实例锁由 main 持有；任务请求标识和计划均持久化，重启不重复派发已领取的任务。
export class MemoryScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private workspace: LocalWorkspace;
  private organizer: Pick<MemoryOrganizer, 'start'>;
  private sessions: Pick<SessionMemory, 'recent'>;
  private now: () => number;
  constructor(
    workspace: LocalWorkspace,
    organizer: Pick<MemoryOrganizer, 'start'>,
    sessions: Pick<SessionMemory, 'recent'>,
    now = Date.now,
  ) {
    this.workspace = workspace;
    this.organizer = organizer;
    this.sessions = sessions;
    this.now = now;
    workspace.db.exec(
      'CREATE TABLE IF NOT EXISTS workspace_memory_schedule (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL)',
    );
    if (!this.load()) {
      const current = now();
      this.save({ nextAt: midnightAfter(current) });
    }
  }
  private load(): Schedule | undefined {
    const row = this.workspace.db.prepare('SELECT payload FROM workspace_memory_schedule WHERE id=1').get();
    return row ? JSON.parse(String(row.payload)) : undefined;
  }
  private save(value: Schedule) {
    this.workspace.db
      .prepare('INSERT OR REPLACE INTO workspace_memory_schedule VALUES (1,?)')
      .run(JSON.stringify(value));
  }
  start() {
    if (this.timer) return;
    const tick = () => {
      try {
        this.tick();
      } catch {
        console.error('每日记忆整理调度失败，保留计划等待下次检查');
      }
    };
    tick();
    this.timer = setInterval(tick, 30000);
    this.timer.unref();
  }
  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
  }
  tick() {
    const schedule = this.load()!,
      current = this.now();
    if ((!schedule.batch || schedule.batch.finished) && current >= schedule.nextAt) {
      const date = dateKey(current),
        id = `nightly-memory:${date}`,
        state = this.workspace.read().state;
      const items: Item[] = [];
      for (const project of state.projects) {
        const employees = new Set<string>(
          state.groups.filter((g: any) => g.projectId === project.id).flatMap((g: any) => g.employeeIds),
        );
        for (const employeeId of employees) {
          if (!state.employees.some((e: any) => e.id === employeeId && e.enabled)) continue;
          const sources = this.sessions
            .recent(project.id, employeeId)
            .filter((s: any) =>
              state.groups.some(
                (g: any) =>
                  g.chatId === s.chatId && g.projectId === project.id && g.employeeIds.includes(employeeId),
              ),
            );
          if (!sources.length) continue;
          for (const store of project.memoryStores) {
            const key = createHash('sha256')
              .update(JSON.stringify([project.id, employeeId, store.id]))
              .digest('hex');
            items.push({
              projectId: project.id,
              employeeId,
              storeId: store.id,
              requestId: `${id}:${key}`,
              status: 'pending',
            });
          }
        }
      }
      schedule.batch = { date, id, items };
      schedule.nextAt = midnightAfter(current);
      this.save(schedule);
    }
    const batch = schedule.batch;
    if (!batch || batch.finished) return;
    if (this.workspace.tasks().find((t) => t.id === batch.id)?.status === 'cancelled') {
      for (const item of batch.items) {
        const task = this.workspace.tasks().find((t) => t.requestId === item.requestId);
        if (task && ['queued', 'running'].includes(task.status)) this.workspace.cancel(task.id);
        if (['pending', 'queued', 'running'].includes(item.status)) item.status = 'cancelled';
      }
      batch.finished = true;
      this.save(schedule);
      return;
    }

    // 各项目、员工串行整理，避免同时覆盖人物条目或放大 MA 并发。
    for (const item of batch.items) {
      if (['completed', 'failed', 'cancelled'].includes(item.status)) continue;
      const existing = this.workspace.tasks().find((t) => t.requestId === item.requestId);
      if (existing) {
        item.taskId = existing.id;
        item.status = existing.status;
        this.save(schedule);
        if (['queued', 'running'].includes(existing.status)) {
          this.report(batch);
          return;
        }
        continue;
      }
      if (
        this.workspace.tasks().some((t) => t.type === 'memory' && ['queued', 'running'].includes(t.status))
      ) {
        this.report(batch);
        return;
      }
      try {
        const task = this.organizer.start({
          projectId: item.projectId,
          employeeId: item.employeeId,
          storeId: item.storeId,
          requestId: item.requestId,
        });
        item.taskId = task.id;
        item.status = task.status;
      } catch {
        item.status = 'failed';
        item.error = '启动失败，请检查员工 MA 配置、项目记忆库和有效群聊来源';
      }
      this.save(schedule);
      this.report(batch);
      return;
    }
    batch.finished = true;
    this.save(schedule);
    this.report(batch);
  }
  private report(batch: NonNullable<Schedule['batch']>) {
    const failed = batch.items.filter((i) => ['failed', 'cancelled'].includes(i.status)).length;
    const completed = batch.items.filter((i) => i.status === 'completed').length;
    this.workspace.putTask({
      id: batch.id,
      requestId: batch.id,
      name: `每日记忆整理 · ${batch.date}`,
      type: 'memory_schedule',
      status: batch.finished ? (failed ? 'failed' : 'completed') : 'running',
      createdAt: `${batch.date}T00:00:00+08:00`,
      ...(batch.finished ? { finishedAt: new Date(this.now()).toISOString() } : {}),
      progress: `完成 ${completed}/${batch.items.length} · 失败 ${failed}`,
      detail:
        '每天北京时间 00:00 整理所有项目的有效群聊来源；人物记忆写入数字员工库，事情记忆按用途写入项目库。',
      steps: batch.items.map(
        (i) =>
          `${i.projectId} / ${i.employeeId} / ${i.storeId}：${i.status}${i.error ? ` · ${i.error}` : ''}`,
      ),
    });
  }
}
