import test from "node:test";
import assert from "node:assert/strict";
import { Gateway, toConversationKey, type IncomingMessage } from "../src/gateway.ts";
import { GatewayStore } from "../src/store.ts";
import { setImmediate as flush } from "node:timers/promises";
const message = (tenantId: string, extra: Partial<IncomingMessage> = {}): IncomingMessage => ({
  channelType:"lark",installationId:"app",tenantId,senderId:`user-${tenantId}`,conversationId:"group",conversationType:"group",threadId:"",rootMessageId:"",parentMessageId:"",eventId:`m-${tenantId}`,messageId:`m-${tenantId}`,text:tenantId,createTime:Date.now(),resources:[],mentionedBot:true,...extra
});
async function until(check:()=>boolean) { for(let i=0;i<150&&!check();i++) await flush(); assert.ok(check()); }

test("不同企业群成员共享分组，个人身份及其他会话边界不变",()=>{
  const a=message('one'),b=message('two');
  assert.deepEqual(toConversationKey(a,true),toConversationKey(b,true));
  assert.equal(b.tenantId,'two');
  for(const changes of [{installationId:'other'},{conversationId:'other'},{threadId:'topic'},{conversationType:'direct' as const}])
    assert.notDeepEqual(toConversationKey(a,true),toConversationKey({...b,...changes},true));
  assert.notDeepEqual(toConversationKey({...a,conversationType:'direct'},true),toConversationKey({...b,conversationType:'direct'},true));
});

test("旧群只有一个分支时复用原 Session；多个分支不自动选择",()=>{
  const store=new GatewayStore(':memory:');
  try {
    const old={...toConversationKey(message('one'),true),tenantId:'one'};
    store.saveSession(old,'existing','agent');
    assert.equal(store.sharedGroupKey(toConversationKey(message('two'),true)).tenantId,old.tenantId);
    store.saveSession({...old,tenantId:'two'},'other-session','agent');
    assert.throws(()=>store.sharedGroupKey(toConversationKey(message('two'),true)),/多个历史会话分支/);
  } finally {store.close();}
});

test("跨企业群消息共用一个 MA Session 并按到达顺序执行",async()=>{
 const store=new GatewayStore(':memory:');store.acquireRuntimeLock();
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);const runs:string[]=[];let creates=0;
 const gateway=new Gateway(store,{createSession:async()=>`s-${++creates}`,run:async(id,input)=>{runs.push(id);if(runs.length===1)await gate;return {terminal:'idle',messages:['ok']};}},async()=>{},
 {agentId:'agent',environmentId:'env',vaultId:'bot',appId:'app',platformAccess:true,sharedGroupSessions:true,durableQueue:true,reportDiagnostics:true,timeoutMs:1000,sessionCompaction:false});
 try {const a=message('one'),b=message('two');gateway.accept(a);await until(()=>runs.length===1);gateway.accept(b);await flush();assert.equal(runs.length,1);release();await until(()=>store.inbox.findMessage(b)?.state==='completed');assert.equal(creates,1);assert.deepEqual(runs,['s-1','s-1']);assert.equal(store.inbox.findMessage(b)?.message.tenantId,'two');}
 finally {release();store.close();}
});

test("群历史缓存跨发言者企业共享，私聊缓存仍隔离",()=>{
 const store=new GatewayStore(':memory:');
 try {
  const a=message('one',{createTime:10}),b=message('two',{createTime:20});
  store.cacheHistory(a,[{messageId:a.messageId,senderId:a.senderId,senderType:'user',source:'chat',text:'群内资料',createTime:10}]);
  assert.equal(store.cachedHistory(b)[0]?.text,'群内资料');
  assert.equal(store.cachedMessage(b,a.messageId)?.text,'群内资料');
  assert.equal(store.cachedHistory({...b,conversationType:'direct'}).length,0);
 } finally {store.close();}
});

test("另一企业成员接入时继续使用唯一旧 Session，不重新创建",async()=>{
 const store=new GatewayStore(':memory:');store.acquireRuntimeLock();const old={...toConversationKey(message('one'),true),tenantId:'one'};
 store.saveSession(old,'old-session','agent');let ran='';
 const gateway=new Gateway(store,{createSession:async()=>{throw new Error('不应创建');},run:async(id)=>{ran=id;return {terminal:'idle',messages:['ok']};}},async()=>{},
 {agentId:'agent',environmentId:'env',vaultId:'bot',appId:'app',platformAccess:true,sharedGroupSessions:true,durableQueue:true,timeoutMs:1000,sessionCompaction:false});
 try {const b=message('two');gateway.accept(b);await until(()=>store.inbox.findMessage(b)?.state==='completed');assert.equal(ran,'old-session');}
 finally {store.close();}
});

test("多个旧群分支立即提示冲突，不静默入队或重跑",async()=>{
 const store=new GatewayStore(':memory:');store.acquireRuntimeLock();let reply='';let runs=0;
 for(const tenantId of ['one','two']) store.saveSession({...toConversationKey(message(tenantId),true),tenantId},`s-${tenantId}`,'agent');
 const gateway=new Gateway(store,{createSession:async()=>{runs++;return 'bad';},run:async()=>{runs++;return {terminal:'idle',messages:['bad']};}},async(_m,out)=>{if(out.type==='text')reply=out.text;},
 {agentId:'agent',environmentId:'env',vaultId:'bot',appId:'app',platformAccess:true,sharedGroupSessions:true,durableQueue:true,timeoutMs:1000});
 try {const m=message('three');assert.equal(gateway.accept(m),false);await until(()=>Boolean(reply));assert.match(reply,/多个历史会话分支/);assert.equal(store.inbox.findMessage(m),undefined);assert.equal(runs,0);}
 finally {store.close();}
});

test("处理完旧任务后可显式选择主 Session，历史分支与身份不删除",()=>{
 const store=new GatewayStore(':memory:');store.acquireRuntimeLock();
 try {
  const canonical=toConversationKey(message('one'),true);
  for(const tenantId of ['one','two'])store.saveSession({...canonical,tenantId},`s-${tenantId}`,'agent');
  store.selectSharedGroupSession(canonical,'s-two');
  assert.equal(store.sharedGroupKey(toConversationKey(message('three'),true)).tenantId,'two');
  assert.equal(store.getSession({...canonical,tenantId:'one'}),'s-one');
  assert.equal(store.getSession(store.sharedGroupKey(canonical)),'s-two');
 } finally{store.close();}
});

test("存在旧排队任务时禁止选择主 Session，不丢任务",()=>{
 const store=new GatewayStore(':memory:');store.acquireRuntimeLock();
 try {
  const m=message('one'),canonical=toConversationKey(m,true),old={...canonical,tenantId:'one'};
  store.saveSession(old,'s-one','agent');
  const task=store.receiveMessage(m,{scope:store.conversationKey(old),agentId:'agent',configFingerprint:'f'.repeat(64)})!;
  assert.throws(()=>store.selectSharedGroupSession(canonical,'s-one'),/未处理或排队任务/);
  assert.equal(store.inbox.findTask(task.id)?.state,'queued');
 } finally{store.close();}
});
