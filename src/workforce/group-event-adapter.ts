// @larksuite/channel 0.4.1 未公开退群事件。仅在此兼容层扩展已有 dispatcher，
// 共用同一 WebSocket，避免另开连接抢占消息；SDK 升级时由兼容测试检查。
export function registerGroupEvents(
  channel: any,
  appId: string,
  handler: (event: { chatId: string; joined: boolean; time?: number }) => void,
) {
  if (!channel.dispatcher?.register) throw new Error('Channel SDK 群事件接口不兼容');
  const receive = (joined: boolean) => (raw: any) => {
    if (raw.app_id && raw.app_id !== appId) return;
    if (!raw.chat_id) return;
    handler({ chatId: raw.chat_id, joined, time: Number(raw.create_time) || undefined });
  };
  channel.dispatcher.register({
    'im.chat.member.bot.added_v1': receive(true),
    'im.chat.member.bot.deleted_v1': receive(false),
  });
}
