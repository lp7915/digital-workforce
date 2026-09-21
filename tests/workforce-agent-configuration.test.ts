import test from 'node:test';
import assert from 'node:assert/strict';
import {
  employeeAgentConfiguration,
  employeeConfigurationHash,
} from '../src/workforce/agent-configuration.ts';

const employee = {
  id: 'e',
  name: '助手',
  description: '描述',
  identity: '身份',
  knowledge: '知识',
  rules: '规则',
  environment: { model: '待配置' },
  skills: [],
};
test('MA 配置包含员工身份和实际模型，默认占位值不发送到 API', () => {
  const config = employeeAgentConfiguration(employee, []);
  assert.equal(config.name, '助手');
  assert.equal(config.description, '描述');
  assert.equal(config.model.id, 'doubao-seed-2-1-pro-260628');
  assert.ok(config.system.includes('身份\n\n规则\n\n知识'));
  assert.equal(
    employeeAgentConfiguration({ ...employee, environment: { model: 'ep-123' } }, []).model.id,
    'ep-123',
  );
  assert.throws(
    () => employeeAgentConfiguration({ ...employee, environment: { model: '错误 模型' } }, []),
    /模型 ID/,
  );
});
test('同步状态只随 MA 配置变化，不因记忆或更新时间变化失效', () => {
  const hash = employeeConfigurationHash(employee);
  assert.equal(
    hash,
    employeeConfigurationHash({ ...employee, memories: [{ content: '新记忆' }], updatedAt: 'today' }),
  );
  assert.notEqual(hash, employeeConfigurationHash({ ...employee, identity: '新身份' }));
  assert.notEqual(
    hash,
    employeeConfigurationHash({ ...employee, skills: [{ id: 'skill-1', version: '2', enabled: true }] }),
  );
});
