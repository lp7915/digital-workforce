# MA 运行环境

员工环境页从 MA `/environments` 分页读取真实环境，返回浏览器的内容仅包括 ID、名称、类型、推荐标记和 lark-cli 初始化方式，不返回脚本或环境变量值。

默认推荐 `workforce-lark-cli-recommended`。该环境不固定 App ID，可供多位员工复用；每次创建 Session 仍由 Gateway 注入当前员工的 Bot 身份与独立 Vault。已有绑定在未主动切换前保留原环境。固定绑定其他飞书 App ID 的环境不允许选择。

推荐环境使用现有 Gateway 的初始化脚本：启动沙箱时安装 lark-cli 1.0.88，按 CPU 架构下载对应二进制，并核对 SHA256。它不是基础镜像原生预装。2026-09-21 使用无凭证的临时 MA Session 实测 `command -v lark-cli` 返回 `/usr/local/bin/lark-cli`，`lark-cli --version` 返回 `1.0.88`。临时 Agent 与 Session 已删除，推荐 Environment 保留。

页面保存时读取 MA 详情校验资源及 App ID 兼容性；新 Session 使用保存的环境。旧 Session 不会原位更换沙箱，环境选择变化后会提示 `/new`。模型仍通过「MA 配置」同步，运行超时需重启 Channel 生效。

其他自定义环境的 lark-cli 状态显示「未确认」，平台不根据名称猜测依赖是否存在，也不会修改其初始化脚本。

官方契约来自方舟文档 MCP：
- [查询环境列表](https://ark.volcengine.com/region:cn-beijing/docs/ark/list-environments-api)
- [创建环境](https://ark.volcengine.com/region:cn-beijing/docs/ark/create-environment-api)
