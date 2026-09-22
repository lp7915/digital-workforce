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
    // 飞书事件头为微秒，消息 create_time 为毫秒；统一后才能正确比较乱序事件。
    const timestamp = Number(raw.create_time);
    const time =
      Number.isFinite(timestamp) && timestamp > 0
        ? timestamp > 1e14
          ? Math.floor(timestamp / 1000)
          : timestamp
        : undefined;
    handler({ chatId: raw.chat_id, joined, time });
  };
  // SDK connect 时会注册默认进群 dispatcher，必须通过公开事件监听保留回调。
  channel.on('botAdded', (event: any) => receive(true)({ ...event.raw, chat_id: event.chatId }));
  channel.dispatcher.register({
    'im.chat.member.bot.deleted_v1': receive(false),
  });
}
