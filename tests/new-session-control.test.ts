import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as flush } from "node:timers/promises";
import { Gateway, toConversationKey, type IncomingMessage, type GatewayOptions } from "../src/gateway.ts";
import { GatewayStore } from "../src/store.ts";
import type { RunInspection } from "../src/ark.ts";

const options: GatewayOptions = { agentId: "agent", environmentId: "env", vaultId: "vault", appId: "app", platformAccess: true,
  sharedGroupSessions: true, durableQueue: true, sessionCompaction: false, timeoutMs: 1000 };
const message = (id: string, extra: Partial<IncomingMessage> = {}): IncomingMessage => ({ channelType: "lark", installationId: "app",
  tenantId: "tenant", senderId: "user", conversationType: "group", conversationId: "chat", threadId: "", rootMessageId: "",
  parentMessageId: "", messageId: id, eventId: id, createTime: 1, text: id, mentionedBot: true, resources: [], ...extra });
const ended: RunInspection = { status: "ended", anchorEventId: "a", terminalEventId: "z", result: { terminal: "idle", messages: ["done"] } };
async function until(check: () => boolean) { for (let i = 0; i < 200 && !check(); i++) await flush(); assert.ok(check()); }
async function fixture(inspect: () => Promise<RunInspection> = async () => ended) {
  const store = new GatewayStore(":memory:"); store.acquireRuntimeLock(); const runs: string[] = [], replies: string[] = [];
  let creates = 0;
  const gateway = new Gateway(store, { createSession: async () => `session-${++creates}`, run: async (session) => {
    runs.push(session); if (runs.length === 1) throw new Error("lost response"); return { terminal: "idle", messages: ["done"] };
  }, inspectRun: inspect }, async (_m, out) => { if (out.type === "text") replies.push(out.text); }, options);
  gateway.accept(message("first")); gateway.accept(message("queued"));
  await until(() => store.inbox.findMessage(message("first"))?.state === "uncertain"); await flush(); await flush();
  return { store, gateway, runs, replies };
}
test("群聊 /new 绕过暂停队列，核查结束后清理旧消息，新消息创建新 Session", async () => {
  const f = await fixture();
  try {
    const reset = message("reset", { text: "/new", senderId: "other", tenantId: "other-tenant" });
    assert.equal(f.gateway.accept(reset), true);
    await until(() => f.replies.some(x => x.includes("已开启新会话"))).catch(error => { throw new Error(JSON.stringify(f.replies), { cause: error }); });
    assert.equal(f.store.inbox.findMessage(reset), undefined);
    assert.equal(f.store.inbox.findMessage(message("first"))?.state, "failed");
    assert.equal(f.store.inbox.findMessage(message("queued"))?.state, "failed");
    assert.equal(f.gateway.accept(reset), false);
    assert.equal(f.gateway.accept(message("queued")), false);
    f.gateway.accept(message("next"));
    await until(() => f.store.inbox.findMessage(message("next"))?.state === "completed");
    assert.deepEqual(f.runs, ["session-1", "session-2"]);
  } finally { f.store.close(); }
});
for (const status of ["running", "unknown"] as const) test(`/new 不清除 MA ${status} 的原任务与队列`, async () => {
  const f = await fixture(async () => status === "running" ? { status, anchorEventId: "a" } : { status, reason: "history_unavailable" });
  try {
    const before = f.replies.length;
    f.gateway.accept(message("reset", { text: "/new" }));
    await until(() => f.replies.length > before);
    assert.equal(f.store.inbox.findMessage(message("first"))?.state, "uncertain");
    assert.equal(f.store.inbox.findMessage(message("queued"))?.state, "queued");
    assert.equal(f.store.getSession(toConversationKey(message("first"), true)), "session-1");
    assert.equal(f.runs.length, 1);
  } finally { f.store.close(); }
});

test("恢复期间收到的新消息保留，重复 /new 不重入，其他话题不受影响", async () => {
  let finish!: (value: RunInspection) => void;
  const f = await fixture(() => new Promise(resolve => { finish = resolve; }));
  try {
    f.gateway.accept(message("reset", { text: "/new" }));
    await until(() => Boolean(finish));
    f.gateway.accept(message("during"));
    f.gateway.accept(message("reset-again", { text: "/new" }));
    f.gateway.accept(message("thread", { threadId: "thread-a" }));
    await until(() => f.store.inbox.findMessage(message("thread", { threadId: "thread-a" }))?.state === "completed");
    assert.equal(f.store.inbox.findMessage(message("during"))?.state, "queued");
    finish(ended);
    await until(() => f.store.inbox.findMessage(message("during"))?.state === "completed");
    assert.equal(f.store.inbox.findMessage(message("queued"))?.state, "failed");
    assert.deepEqual(f.runs, ["session-1", "session-2", "session-3"]);
    assert.ok(f.replies.some(x => x.includes("此会话正在恢复")));
  } finally { f.store.close(); }
});

test("运行中的任务不会被 /new 中断，控制命令立即响应且不入队", async () => {
  const store = new GatewayStore(":memory:"); store.acquireRuntimeLock();
  let finish!: () => void; const replies: string[] = [];
  const gateway = new Gateway(store, { createSession: async () => "session", run: async () => {
    await new Promise<void>(resolve => { finish = resolve; }); return { terminal: "idle", messages: ["done"] };
  } }, async (_m, out) => { if (out.type === "text") replies.push(out.text); }, options);
  try {
    gateway.accept(message("active")); await until(() => Boolean(finish));
    const reset = message("reset", { text: "/new" }); gateway.accept(reset);
    await until(() => replies.some(x => x.includes("仍有任务执行中")));
    assert.equal(store.inbox.findMessage(reset), undefined);
    assert.equal(store.inbox.findMessage(message("active"))?.state, "dispatched");
    finish(); await until(() => store.inbox.findMessage(message("active"))?.state === "completed");
    assert.equal(gateway.accept(reset), false);
  } finally { finish?.(); store.close(); }
});

test("准备阶段配置失败可清理并保留历史，重复投递不会再执行", async () => {
  const store = new GatewayStore(":memory:"); store.acquireRuntimeLock(); const replies: string[] = [];
  const gateway = new Gateway(store, { createSession: async () => "session", run: async () => ({ terminal: "idle", messages: [] }) },
    async (_m, out) => { if (out.type === "text") replies.push(out.text); }, { ...options, beforeBusinessTurn: async () => { throw new Error("invalid config"); } });
  try {
    gateway.accept(message("failed")); gateway.accept(message("queued"));
    await until(() => store.inbox.findMessage(message("failed"))?.state === "uncertain"); await flush(); await flush();
    gateway.accept(message("reset", { text: "/new" }));
    await until(() => replies.some(x => x.includes("已开启新会话")));
    assert.equal(store.inbox.findMessage(message("failed"))?.state, "failed");
    assert.equal(store.inbox.findMessage(message("queued"))?.state, "failed");
    assert.equal(gateway.accept(message("failed")), false);
  } finally { store.close(); }
});

test("控制命令拒绝未授权用户，群聊未 @ 机器人时不触发重置", async () => {
  const store = new GatewayStore(":memory:"); store.acquireRuntimeLock(); const replies: string[] = [];
  const gateway = new Gateway(store, { createSession: async () => "", run: async () => ({ terminal: "idle", messages: [] }) },
    async (_m, out) => { if (out.type === "text") replies.push(out.text); }, { ...options, platformAccess: false, authorizedUserId: "owner" });
  try {
    assert.equal(gateway.accept(message("not-mentioned", { text: "/new", mentionedBot: false })), false);
    gateway.accept(message("denied", { text: "/new" }));
    await until(() => replies.some(x => x.includes("未授权")));
    assert.equal(store.listAuditLogs().length, 0);
  } finally { store.close(); }
});

test("/new 清理超过一页的积压记录，并保留其他群的队列", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 105; i++) f.gateway.accept(message(`backlog-${i}`));
    f.gateway.accept(message("other-chat", { conversationId: "other-chat" }));
    await until(() => f.store.inbox.findMessage(message("other-chat", { conversationId: "other-chat" }))?.state === "completed");
    f.gateway.accept(message("reset", { text: "/new" }));
    await until(() => f.replies.some(x => x.includes("已开启新会话")));
    for (let i = 0; i < 105; i++) assert.equal(f.store.inbox.findMessage(message(`backlog-${i}`))?.state, "failed");
    assert.equal(f.store.inbox.findMessage(message("other-chat", { conversationId: "other-chat" }))?.state, "completed");
    assert.equal(f.runs.length, 2);
  } finally { f.store.close(); }
});

test("准备阶段有未决外部操作时整批回滚，不部分清理队列", () => {
  const store = new GatewayStore(":memory:"); store.acquireRuntimeLock();
  try {
    const key = toConversationKey(message("pending"), true);
    const binding = { scope: store.conversationKey(key), agentId: "agent", configFingerprint: "config" };
    const first = store.receiveMessage(message("pending"), binding)!;
    let preparing = store.inbox.claim(first.id, binding)!;
    preparing = store.inbox.beginPreparationPlan(preparing, { reusable: true });
    preparing = store.inbox.beginPreparationStep(preparing, preparing.preparationPlan!.id, {
      id: "upload", kind: "attachment", inputFingerprint: "a".repeat(64)
    });
    const interrupted = store.finishMessage(preparing.id, "failed");
    const queued = store.receiveMessage(message("queued"), binding)!;
    store.saveSession(key, "old", "agent");
    assert.throws(() => store.resetConversationQueue(key, [queued, interrupted], message("reset", { text: "/new" })), /未核实/);
    assert.equal(store.inbox.findTask(queued.id)?.state, "queued");
    assert.equal(store.getSession(key), "old");
  } finally { store.close(); }
});

test("准备检查点清理后仍可读取审计证据，重启恢复不会重新入队", () => {
  const store = new GatewayStore(":memory:"); store.acquireRuntimeLock();
  try {
    const key = toConversationKey(message("pending"), true);
    const binding = { scope: store.conversationKey(key), agentId: "agent", configFingerprint: "config" };
    const first = store.receiveMessage(message("pending"), binding)!;
    let preparing = store.inbox.claim(first.id, binding)!;
    preparing = store.inbox.beginPreparationPlan(preparing, { reusable: true });
    const interrupted = store.finishMessage(preparing.id, "failed");
    store.resetConversationQueue(key, [interrupted], message("reset", { text: "/new" }));
    assert.deepEqual(store.inbox.findTask(first.id)?.preparationPlan, preparing.preparationPlan);
    const recovered = store.recoverMessages("lark", "app");
    assert.equal(recovered.queued.length + recovered.interrupted.length, 0);
  } finally { store.close(); }
});
