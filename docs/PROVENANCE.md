# 复用来源与许可边界

来源：`upstream/ark-agent-feishu-bot`
提交：`1e1b3db8986c836ecd84dd0d21ab17f683015983`，包版本 `0.2.10-rc.4`。
仅从 Git HEAD 提取已跟踪 src、tests、构建/检查脚本和依赖锁文件；不读取或复制真实配置、凭据、数据库、日志、附件、node_modules 或 .git。
旧目录 3 个未跟踪文件保持原样：docs/test-results/pdf-understanding-2026-09-09.json、scripts/create-pdf-repro-fixtures.py、scripts/probe-pdf-understanding.mjs。
上游未发现已跟踪 LICENSE/NOTICE；不擅自赋予开源许可，保留来源与现有声明，仅在用户授权的独立本地项目复用，不公开发布。
复用 MA、Gateway、Channel、流式卡片、附件处理、OAuth 和其依赖状态模块；旧 CLI/init/web 为回归依赖保留，不作为本项目入口，不运行旧部署/初始化流程。
新增代码位于 src/workforce、public、tests/workforce*；Gateway 的差异为可选业务生命周期钩子，默认路径保持兼容。

# 设计依据

完整阅读本地 section-1.xml 至 section-9.xml，目录 `design/agent-memory/`。
设计仍为待评审方向。MA 原生 Memory 不参与首版本地业务权限；采用 Gateway SQLite 存储，原生 Memory 的只读/版本/动态挂载契约未验证。
已阅读企业应用设计、building-with-volcano-managed-agents-api 技能及其四份 references。
2026-09-20 官方文档入口 https://docs.volcengine.com/docs/82379/2555910?lang=zh 读取失败。MA 请求复用已有契约测试，真实端到端另行验证。
