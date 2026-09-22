import test from 'node:test';
import assert from 'node:assert/strict';
import { personEvidence, personContent } from '../src/workforce/person-memory.ts';

test('人物来源仅采信群 Session 的真实本轮发言者，不把被提及的人当作来访者', () => {
  const rows = personEvidence(
    [
      {
        eventId: 'evt',
        type: 'user.message',
        text: '<current_actor open_id="ou_alice" />\n\n<current_message message_id="m" chat_id="oc_group" />\n\n<current_request>我是小王，负责内容。小李负责设计。</current_request>',
      },
    ],
    { id: 's', chatId: 'oc_group' },
  );
  assert.deepEqual(rows, [{ openId: 'ou_alice', eventId: 'evt', sessionId: 's', chatId: 'oc_group' }]);
  assert.deepEqual(
    personEvidence(
      [{ eventId: 'bad', type: 'agent.message', text: '<current_actor open_id="ou_other" />' }],
      { id: 's', chatId: 'oc_group' },
    ),
    [],
  );
});
test('人物记忆按稳定身份生成路径，姓名职能和特点不确定时不编造', () => {
  const x = personContent({ openId: 'ou_alice', name: '小王', role: '内容负责人', traits: ['偏好简洁结论'] });
  assert.equal(x.path, 'people/ou_alice.md');
  assert.match(x.content, /内容负责人/);
  assert.match(personContent({ openId: 'ou_unknown', traits: [] }).content, /未确认/);
  assert.throws(() => personContent({ openId: '../project', traits: [] }), /身份/);
});
