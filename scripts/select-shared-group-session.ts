import { GatewayStore } from '../src/store.ts';
const args = process.argv.slice(2);
const option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i+1]; };
const database = option('--db'), app = option('--app'), chat = option('--chat'), session = option('--session');
if (!database || !app || !chat || !session || !args.includes('--confirm')) {
  console.error('用法：node --experimental-strip-types scripts/select-shared-group-session.ts --db <机器人数据库> --app <应用ID> --chat <群ID> [--thread <话题ID>] --session <保留的SessionID> --confirm\n先停止对应网关；所有旧任务必须已经核查并处理。此操作保留旧数据，不重放消息。');
  process.exit(1);
}
const store = new GatewayStore(database);
try {
  store.acquireRuntimeLock();
  store.selectSharedGroupSession({channelType:'lark',installationId:app,tenantId:'@shared-group',conversationId:chat,threadId:option('--thread') || '',senderId:''},session);
  console.log('已选择共享群的主 Session；历史分支与任务证据保留，可重启对应网关。');
} catch(error) { console.error(error instanceof Error ? error.message : '选择失败'); process.exitCode=1; }
finally {store.close();}
