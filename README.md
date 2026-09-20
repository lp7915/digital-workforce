# 数字员工工作台

独立本地项目：Web 管理后台 + 飞书 Bot Gateway + 版本化 Identity / Knowledge + 按权限共享的项目记忆。

## 本机启动

```sh
cd /path/to/digital-workforce
npm ci --ignore-scripts
npm start
```

需要 Node.js 22.13 或以上；使用原生 `node:sqlite` 和 TypeScript strip-types。默认地址：**http://127.0.0.1:8790**。

首次运行生成 `data/admin-token`（600 权限）。在本机终端执行 `cat data/admin-token`，将令牌粘贴到登录框。令牌不写入日志，不进入浏览器 localStorage，不传给模型。登录会话有效期 8 小时。

`WORKFORCE_PORT` 可改端口；`WORKFORCE_DATA_DIR` 可指定独立数据目录。服务固定监听 `127.0.0.1`，不提供默认公网开放模式。停止 Web：在启动终端按 Ctrl+C。

## 页面与权限

| 页面 | 已实现操作 |
|---|---|
| 数字员工 | 列表、创建、详情、Identity/Knowledge 草稿编辑、不可变发布快照、版本对比、切回历史版本 |
| 项目与群聊 | 项目创建/设置、项目管理员名单、自动提炼开关、多群绑定、双方共享范围、按群指定发布版本 |
| 项目记忆 | 查看、消息/群/话题/Session 来源追溯、纠正、删除、冲突处理、项目规则审批、长期资料登记及撤权 |
| 运行与后台任务 | 实际规则版本、记忆修订、后台状态/失败/重试、Bot 心跳、Session 待升级状态 |
| 本地验收室 | 真实 Gateway、队列与数据库；外部响应来自明确标注的本地适配器，不调用 MA/飞书 |

访问管理页面及创建成员访问令牌接口暂不提供，待实际部署时再设计接入。当前保留本机管理员令牌登录与项目数据隔离。

管理员管理员工和发布；项目管理员必须在项目的 `managers` 名单中，才能管理该项目的绑定、记忆、资料、任务。项目管理员不能发布全局规则。普通成员只能查看发布配置和被授权可见内容。所有写权限由 HTTP 后端与业务服务执行。

本机管理员具有全局管理和审计权限；这不是企业 SSO/多租户认证实现。访问令牌保存在本机私有环境，第一版不用于公网部署。

## 无凭据验收

1. 创建员工、编辑并保存职责、发布第一版。MA ID 留空时仍可本地验收，但真实 Bot 拒绝启动。
2. 创建项目，绑定同一员工到 `internal-a` 和 `internal-b`。A 的共享列表填 B，B 的共享列表填 A。
3. 在本地验收室的 A 发送 `确认决策：交付日期=10月15日`。
4. 连续空闲至少 30 秒后，在任务页确认提交完成，再从 B 提问。结果应包含日期和来源轮次。
5. 添加不共享的群或其他项目，验证不可见。纠正日期后，原 Session 下一轮应读到新版事实。
6. `/new` 后记忆保留；删除/撤权导致旧 MA 上下文不再可信时，服务端阻止继续复用，提示显式 `/new`。

本地验收所用示例员工、项目、群名都标记为“本地验收”，不对应真实飞书应用。服务重启后保留业务数据与项目记忆，本地适配器 Session 会重新创建。

## 真实飞书 Bot

仅使用**独立测试应用、独立 MA 环境与 Bot Vault**。本项目不会读取旧项目配置、复制生产 Bot 身份、修改原部署或自动初始化云资源。

```sh
cp docs/test-bot.example.json work/test-bot.json
chmod 600 work/test-bot.json
# 在本机编辑占位项；不要提交凭据文件
npm run bot -- --config work/test-bot.json --check
npm run bot -- --config work/test-bot.json --start
```

需要：Web 员工 ID、独立飞书 App ID/Secret、测试租户/群/用户白名单、MA API Key、Environment、独立 Bot Vault，以及已存在的 `LARKSUITE_CLI_TENANT_ACCESS_TOKEN` Credential ID。员工发布快照中填写真实 Agent ID 和数字版本。

`--check` 只校验本地配置和发布快照，不声称外部资源可用。`--start` 显式连接飞书 WebSocket。仅处理白名单范围内的私聊或 @Bot 群消息。每个员工/应用有本机运行锁，避免本项目重复启动同一应用。

启用 `enableUserOAuth: true` 后，白名单单聊沿用原项目 OAuth、Vault 隔离与授权恢复机制；群聊仅使用 Bot 身份。个人 UAT 及单聊原文不参与项目记忆提炼。Bot 默认关闭个人 OAuth。

启动过程只维护明确配置的测试 Bot Credential，不会创建应用、Agent、Environment 或应用 Vault。个人 OAuth 授权时按原链路创建隔离的用户 Vault/Credential。退出 Bot：在其终端按 Ctrl+C；不会停止其他网关。Web 与 Bot 是两个独立进程，后台提炼由 Web 进程执行。

真实业务消息队列沿用原项目默认队列路径；后台记忆任务持久化且可重启恢复。业务运行结果未知时不会自动重新派发，需人工核查或显式新建会话；本版本未开启上游实验性的 durableQueue 自动恢复路径。

## 后台提炼与保守边界

默认使用可测试的明确确认语法：`确认事实/确认决策/确认约定/确认偏好/确认规则：键=值`。未确认建议、闲聊、敏感信息、聊天越权指令及私聊不会自动进入项目记忆。自由自然语言的自动事实判定仍待进一步评审。

任务持久化记录事件范围、来源绑定修订、状态和重试次数。连续空闲最少 30 秒且无排队/运行/授权等待后才领取。冻结范围之外的消息留给下次。提交与游标原子更新，重复提交幂等，失败最多重试 3 次。两个群可并行提炼，SQLite 提交阶段短暂串行。冲突不静默覆盖。

可选独立 MA 候选筛选器：复制 `docs/extractor.example.json` 到 `work/extractor.json`，使用600权限，填入**独立、无凭据和无业务工具的提炼环境**，再运行：

```sh
WORKFORCE_EXTRACTOR_CONFIG=work/extractor.json npm start
```

它只处理已通过明确确认语法筛出的候选，不发送其他原始聊天，不挂载 Vault，并显式覆盖 tools/skills/mcp_servers 为空。模型输出仍须逐条通过 Gateway 验证。后台 Session 与业务 Session 分离；非幂等创建或派发结果不明时先核查，不盲目重试。这些 MA override 的真实平台隔离语义仍需测试环境验证，当前只完成契约测试。

已运行轮次固定发布版本和记忆快照；下一轮读取最新获准记忆。一般纠正可直接刷新；删除、撤权、项目换绑或无法安全热更的发布版本要求显式 `/new`，不自动丢弃原 Session。Agent ID 变化还需重启独立 Bot 进程。不存在网关自动 compact。

资料登记只保存权限受控的长期链接，不复制实际文件、不承诺 `/new` 后沙箱文件迁移。远端资料删除/撤权目前通过管理台手动同步，尚未订阅远端权限事件。未配置自动保留期限或隐私分类系统；真实推广前需确定敏感信息范围与保留政策。

## 验证

```sh
npm test
npm run check
npm run format:check
npm run build
```

`check` 沿用原项目 Node 语法检查，并非完整类型检查。本机额外以 TypeScript 5.9.3 执行：

```sh
tsc --noEmit --allowImportingTsExtensions --module nodenext --target esnext --skipLibCheck src/workforce/*.ts
```

测试只使用 mock MA/OAuth/飞书和本机临时 HTTP，不消耗外部额度。部分测试需允许 127.0.0.1 临时监听。复用来源与修改记录见 `docs/PROVENANCE.md`，验收结果见 `outputs/交付说明.md`。

## 目录

- `src/workforce/`：新增业务服务、Web、Bot 入口、提炼器和 Gateway 接口。
- `public/`：管理台前端；所有用户文本转义渲染。
- `src/` 其余模块、`tests/` 原有测试：选择性复用的既有 MA/Channel/网关链路。
- `data/`：本地 SQLite、令牌与运行锁，不纳入 Git。
- `work/`：开发中间文件、测试配置和原始测试日志，不纳入 Git。
- `outputs/`：用户交付说明和验收截图。

包标记为 `private: true`。未执行 GitHub/npm 发布、云部署或任何生产迁移。
