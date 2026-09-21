# MA 原生记忆与整理验收

## 已实现的链路

工作台只保存员工、项目、群关联和 MA 资源 ID。记忆库及条目正文以 MA Memory Store 为准，列表按需加载，正文单独读取。旧记忆逐条迁移并回读核验后，才移除本地工作台中的正文；迁移失败保留原文与恢复标记。

创建 Session 时，以 `resources: [{ type: "memory_store", memory_store_id, access: "read_only" }]` 挂载员工记忆库和当前群所属项目的记忆库。单聊仅挂载员工记忆。MA 最多允许 10 个库，只能在创建 Session 时指定；关联或员工配置变化后使用 `/new`，不继续使用含旧项目上下文的 Session。

整理使用独立 MA Agent，通过 MA Custom Tool 读取来源 Session、查询已有条目、创建或更新条目。平台在服务端执行工具，固定目标项目和记忆库，不向 Agent 传递 API Key 或飞书 Vault。不会通过修改只读挂载目录来写入记忆。

## 用户验收步骤

1. 打开 `http://127.0.0.1:8790`，在右上角方舟配置保存并验证 API Key，确认绿色已连接。
2. 新建数字员工，配置身份、知识、规则、模型和 MA 技能。首次绑定飞书时创建 MA Agent；已有员工修改后，点击标题旁「MA 配置」同步。同步以新 Session 生效。
3. 在飞书配置完成当前用户扫码绑定；服务端准备 Agent、Environment、Vault 和 Channel，页面显示连接状态。
4. 创建项目，在项目记忆中启用 MA 记忆库，添加带路径的文本条目。在群聊模块关联项目，并将数字员工加入群聊。
5. 在群内 @ 数字员工发送 `/new`，再询问项目记忆中的已知信息，验证按需读取。
6. 在项目成员中将测试者的飞书 `open_id` 配置为「可改写」或「管理」。这个 ID 必须匹配对应员工机器人实际收到的发送者 ID。
7. 在群中完成一轮含明确项目决策的对话，再 @ 员工发送 `/remember`；也可在后台项目记忆点击「整理近期 Session」，选择员工和目标库。
8. 在任务页查看进度、结果路径及失败原因，回到项目记忆点「刷新」，确认整理内容和来源 Session。

群内命令默认写入该项目第一个记忆库。后台可选择目标库。仅整理该员工最近 7 天、最多 10 个已完成对话的项目 Session；此次升级前未记录项目归属的旧 Session 不自动纳入。后台当前按本机管理员身份发起，正式部署前需接入身份与访问管理。

## 一致性与失败处理

- 相同请求 ID 不重复发起整理；同一项目只运行一个整理任务。工具调用有回执去重。
- 更新条目前比较读取时的内容 SHA，避免覆盖已知的新内容。MA 本身采用最后写入生效；外部直接调用 MA 与本平台的极短并发窗口不具备服务端原子条件更新保证。
- MA 修改路径可能返回新的条目 ID，界面跟随返回值更新选择。
- 整理无删除工具。写入需要已读取的同项目来源，每次写入前复核项目权限与群关联。
- 请求超时、远端创建结果未知或进程重启，不盲目重放；任务保留已完成写入记录及 Session ID，失败时需核查后重新整理。部分写入不会自动回滚。
- 配置名称/区域、额外凭证引用、工作台版本快照仍是本地管理信息；飞书运行必需的 Environment 和 App Secret 凭证由绑定流程创建。模型/身份/知识/规则/技能可同步 MA Agent。修改运行超时后需重启该员工 Channel。

## 本轮验证

- 使用真实 MA 临时资源验证 Store、条目创建/读取/路径与正文更新/删除、Session 原生挂载，以及员工 Agent 实际读取文件。
- 使用真实 MA 独立整理 Agent，完成来源 Session → Custom Tool → 项目 Memory Store 写回与回读；临时 Session、Agent、Store 均已清理。
- 以上不发送飞书消息。用户扫码、真实群内提问和 `/remember` 的完整体验留给上述验收步骤。

## 官方依据

通过用户提供的方舟文档 MCP `https://mcp.ark-doc-resources.cn/mcp/` 读取：

- [持久记忆](https://ark.volcengine.com/region:cn-beijing/docs/ark/persistent-memory)
- [创建记忆](https://ark.volcengine.com/region:cn-beijing/docs/ark/create-memory-api)
- [更新记忆](https://ark.volcengine.com/region:cn-beijing/docs/ark/update-memory-api)
- [Custom Tool 教程](https://ark.volcengine.com/region:cn-beijing/docs/ark/managed-agent-custom-tool-tutorial)
