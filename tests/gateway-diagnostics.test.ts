import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayDiagnostic, localFailure, recentEventSummary } from '../src/gateway-diagnostics.ts';

test('异常诊断关联 Session 与最近八条事件，排除消息正文和工具输入', async () => {
  const text = await gatewayDiagnostic({ stage: '任务执行', messageId: 'm1', sessionId: 'session-1', error: new Error('下载失败'),
    readEvents: async id => { assert.equal(id, 'session-1'); return Array.from({length: 10}, (_, i) => ({id: `event-${i}`, type:'tool.failed', content:'PRIVATE_BODY', arguments:{secret:'PRIVATE_ARG'}})); } });
  assert.match(text, /session-1/); assert.match(text, /event-9/); assert.doesNotMatch(text, /event-0|PRIVATE_BODY|PRIVATE_ARG/);
});
test('本地 SDK 错误保留状态码和请求 ID，不传播配置和凭证', () => {
  const error = Object.assign(new Error('失败 Authorization: Bearer abc123 token=private-token https://host/path?signature=private-url'), { response:{status:403,data:{code:9999,log_id:'request-123',token:'PRIVATE'}},config:{headers:{Authorization:'PRIVATE'}} });
  const text=localFailure(error); assert.match(text,/403/);assert.match(text,/9999/);assert.match(text,/request-123/);assert.doesNotMatch(text,/abc123|private-token|private-url|PRIVATE/);
});
test('events 查询超时仍返回原始错误，不阻塞会话', async () => {
  let signal: AbortSignal | undefined;
  const text=await gatewayDiagnostic({stage:'恢复',messageId:'m1',sessionId:'s1',error:new Error('原错误'),timeoutMs:10,readEvents:async(_,s)=>{signal=s;return new Promise(()=>{});} });
  assert.match(text,/原错误/);assert.match(text,/查询 events 超时/);assert.equal(signal?.aborted,true);
});
test('事件上游 JSON 只提取错误码与参数，不转发完整 payload', () => {
  const text=recentEventSummary([{id:'e1',type:'session.failed',error:{type:'model_request_failed_error',message:JSON.stringify({error:{code:'InvalidParameter',param:'file_url',token:'PRIVATE'}})}}]).join();
  assert.match(text,/InvalidParameter/);assert.match(text,/file_url/);assert.doesNotMatch(text,/PRIVATE/);
});
test('Session 未建立也返回诊断且不请求 events', async () => {
  const text=await gatewayDiagnostic({stage:'创建',messageId:'m1',error:new Error('配置缺失'),readEvents:async()=>{throw new Error('不应执行');}});
  assert.match(text,/尚未创建/);assert.doesNotMatch(text,/不应执行/);
});

test('MA 诊断沿事件分页获取真正的末尾八条', async () => {
  const { ArkClient } = await import('../src/ark.ts');
  const urls: string[] = [];
  const client = new ArkClient('test-key', 'https://ark.example.com', async (url: any) => {
    urls.push(String(url));
    const second = String(url).includes('page=next');
    return Response.json({data: Array.from({length: 6}, (_, i) => ({id:`event-${i + (second ? 6 : 0)}`,type:'session.status_idle'})), ...(second ? {} : {next_page:'next'})});
  });
  const events = await client.diagnosticEvents('session-one', new AbortController().signal);
  assert.equal(urls.length, 2);
  assert.deepEqual(events.map(e=>e.id), Array.from({length:8},(_,i)=>`event-${i+4}`));
});
