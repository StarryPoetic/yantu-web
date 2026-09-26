# 受控模型与网页问答

测评规则调用 `createExplanationModule(...).explainAssessment(attempt, subjectId)`。只允许本人、已提交、适用的测评，输入仅包含本次诊断所需题目证据；可选过程默认不发送。固定解析随时可用，模型失败不会影响评分。模型结果只允许引用原解析、原答案和获准假设，不展示无法验证的自由诊断。

`DeepSeekAdapter` 固定访问官方 `https://api.deepseek.com/chat/completions`，使用 `deepseek-flash`、`thinking: disabled`、非流式 JSON、最多 800 输出 token、30 秒超时。密钥从服务端配置传入，不能使用 VITE 环境变量或客户端请求体。显式 `enabled: true` 才允许真实调用；不自动重试、不切换高价模型，拒绝重定向和非正常结束输出。协议核验日期为 2026-09-27，依据：[DeepSeek 官方接口](https://api-docs.deepseek.com/api/create-chat-completion/)。

`createWebAnswerModule(config).answer({subjectId, question, urls, search})` 只处理用户问题与公开网页，不能读取题库、用户画像、任意数据库或改变招生事实。最多读取两个精确允许的官网主机；服务端 `allowedHosts` 可以扩展，用户请求不能扩展。连接使用 HTTPS，检查所有 DNS 地址均为公网并固定实际连接 IP，保留 TLS 主机名校验；禁止重定向、私网、IP 直连、超大文件及非文本格式。

用户启用 `search` 时，服务端还必须设置 `searchEnabled` 和 `searchKey`（应用环境变量 `YANTU_SEARCH_ENABLED` 与 `BRAVE_SEARCH_API_KEY`）。仅执行一次 Brave 搜索，最多五条摘要，不自动抓取任意搜索结果链接；未配置显示明确原因。使用 [Brave 官方接口](https://api-dashboard.search.brave.com/app/documentation/web-search)的 `GET /res/v1/web/search` 与 `X-Subscription-Token`。搜索默认每用户每天 10 次、全站 100 次，可以在服务端调整。

网页回答采用可核验的逐字摘录，输出引用必须属于本次证据且能在对应片段找到。记录抓取时间，搜索摘要与官网原文区别显示，所有网页证据均为 `verified:false`，不自动进入正式知识库。若无法形成回答，仍可显示来源供用户核对；绝不假称已联网。输入中的提示注入文本始终按数据处理。

预算与缓存默认在当前进程：每用户 20000、全站 100000 token/日，并发分别 1 和 4；按最大输出和保守输入预留，超时/计量未知保留预留额度。应用创建同一个 `createModelRuntime(config)` 并通过 `runtime` 注入测评解释和网页问答，使跨任务预算共享。用户、依据版本、提示版本和模型配置均进入缓存键。`clearSubject` 清除私有缓存并阻止删除前请求重新写入；服务器也应以删除代次防止持久化。**多进程或生产部署应将预算预留迁移到共享事务存储，并完成真实学科、费用、隐私与故障验收后才启用模型。** 普通测试全部模拟网络，不产生费用。
