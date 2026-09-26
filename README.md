# 研途 · 考研专业与院校选择工作台

基于 [产品设计文档 V0.5](docs/产品设计文档.md)、[技术设计文档清单](docs/技术设计/00-文档清单与需求映射.md) 与现有 demo 实现的全栈应用。默认页面使用服务端会话和数据库，旧离线 demo 仅供开发回归。具体工程决策、实现范围与发布门槛见[实施说明](docs/实施说明.md)。

## 启动

需要 Node.js **24.14+**。完整验证还需要 Python 3 与 Chromium。

```powershell
npm ci
npm run dev
```

打开 http://127.0.0.1:4173 。前端和后端一起启动，数据库自动创建在 `var/yantu.sqlite`，重启后资料保留。开发模式提供明确标识的示例目录和题库；不需要模型密钥即可完成用户流程。

```powershell
npx playwright install chromium
npm run check
```

单独运行：`npm run build`、`npm run test:unit`、`npm run test:docs`、`npm test`。浏览器验证覆盖默认应用和 `/?demo=1`，数据库/API 与模型/联网失败路径另有测试。测试不进行真实收费调用。

## 已实现的流程

- 个人画像与七项偏好：城市中文、拼音、首字母搜索，多选、自定义与不确定；保存、刷新恢复、版本冲突提示及删除范围预览。
- 专业与院校联合探索：年度、学校、城市、专业、学位筛选，项目详情和来源，收藏、屏蔽学校/方向/项目及恢复，最多三个完整项目对比。
- 服务端推荐：固定画像、选择、目录和规则版本，资格优先、稳定排序、缺失依据说明。未知资格单列，不补齐前十，不生成虚假匹配百分比。
- 服务端测评：公共科目自由选择，每科五题，专业确认后可选专业课；固定题集、分层组卷、草稿保存、自动切题、末题主动提交、确定性诊断和解析。
- 目标与规划：按项目实际科目设置目标，校验单科与总分，未知资料保持待核验；阶段任务持久化，专业变化标记计划需复核。
- 报告与反馈：固定版本的 Markdown 报告、下载与历史记录、纠错提交和处理状态。
- 资料后台：不同身份的录入、独立复核、发布、撤回、审计；题库逐项审校、风险和规则两人复核。
- 咨询助手：服务端 DeepSeek 适配、按需 Brave 搜索与官网读取、来源链接和检索时间。模型不可用时固定解析及资料查询仍可用。

## 知识库和模型放在哪里

| 内容 | 扩展位置 | 说明 |
| --- | --- | --- |
| 招生目录、来源、政策/就业/评价依据 | [knowledge/catalog](knowledge/catalog/README.md) | 完整年度项目 JSON → 草稿 → 独立审核 → 版本发布；不复制推荐代码。 |
| 题目、答案、范围、难度与审校 | [knowledge/questions](knowledge/questions/README.md) | 服务端独立题库；扩建题目不改页面。 |
| 资格、偏好和排序 | [server/recommendation](server/recommendation/index.ts) | 确定性规则，独立于模型。 |
| 分科计划与报告 | [server/planning](server/planning/index.ts)、[server/reports](server/reports/index.ts) | 使用固定项目与运行快照。 |
| DeepSeek、额度与网页检索 | [server/explanation](server/explanation/README.md) | 模型和搜索密钥只读服务端环境；网络资料不自动发布进可信库。 |
| API、会话与数据保存 | server/routes、server/app.ts、server/store.ts | 版本、幂等、权限和事务统一处理。 |
| 正式前端 | src/workspace | 画像、目录、测评、规划、助手和后台分模块加载。 |

## 配置模型、搜索和后台

参考 [.env.example](.env.example)。开发脚本支持通过系统环境变量传入配置；用本地环境文件时：

```powershell
node --env-file=.env scripts/dev.mjs
```

- 模型：设置 `YANTU_MODEL_ENABLED=true` 与 `DEEPSEEK_API_KEY`。默认固定模板，不自动探测真实凭据。
- 搜索：设置 `YANTU_SEARCH_ENABLED=true` 与 `BRAVE_SEARCH_API_KEY`。用户可选择允许联网，并提供最多两个官方网页地址。无搜索配置时明确降级。
- 官方网页：默认精确白名单包含研招网等；部署方用 `YANTU_OFFICIAL_HOSTS` 维护实际允许的主机。限制 HTTPS、公网 DNS、固定连接 IP、拒绝跳转、超时和内容大小。
- 后台：`YANTU_ADMIN_CREDENTIALS` 为独立操作者的 JSON 配置，每项含 `actorId`、至少 24 字符随机 `token`、`roles`。角色为 `editor`、`reviewer`、`publisher`、`auditor`。页面输入后只存内存；不提供默认管理密码。规则和风险须有两名不同复核者，录入者不能自审。

不要将密钥放入 `VITE_` 变量、前端代码、知识库或 Git。`.env`、数据库及日志均已忽略。模型与检索测试使用模拟响应，本次交付不代表真实账户已启用。

## 构建与单实例部署

```powershell
npm run build
$env:NODE_ENV='production'
$env:YANTU_ORIGIN='https://your-domain.example'
$env:YANTU_DATABASE_PATH='D:\yantu-data\production.sqlite'
npm start
```

API 与构建页面由同一服务提供，默认监听 `127.0.0.1:8787`，由 HTTPS 反向代理接入；可配置 `HOST`、`PORT`。生产必须使用独立数据库与 HTTPS 来源，并自动禁用示例数据；若数据库包含活动示例发布，启动会拒绝。实际部署时使用自己的域名与受保护配置。

数据库使用 SQLite WAL，当前面向单实例。报告、发布和删除为有持久状态的短事务作业。没有预装 PostgreSQL、队列集群或自动备份；跨进程部署前需升级存储、共享额度/限流和作业策略。模型额度为单进程日额度，重启会重置，不应据此宣称长期账单硬上限。

## 数据与使用边界

开发目录中的八个项目和二十道题仅用于流程验证。真实招生数据、题库学科审校、排序规则与分数依据仍须人工审核。生产无获批规则时返回未就绪，资料不足时不生成正式排名；历史门槛、备考目标和当前能力分别保存，五题测评不能换算考研成绩或录取概率。

匿名会话 Cookie 有效期 30 天，无跨设备账号绑定。删除会清除画像、测评、推荐、报告、收藏、屏蔽、确认专业、目标、任务、纠错与个人缓存；保留当前会话和无内容的删除状态。此实例不自动备份；不能删除用户已下载文件。正式留存、备份恢复、监控和容量目标须在实际上线环境验收。

原 demo 缓存不自动迁入服务端，`/?demo=1` 只在开发服务器可访问。生产构建不包含旧 demo 与其题目答案。城市目录仍是[有来源说明的离线快照](docs/city-data.md)，不宣称实时或全国招生项目全覆盖。
