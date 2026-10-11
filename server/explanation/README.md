# 模型解释、自由对话与受控检索

任务二新API流程先运行 `research-prefilter.ts` 本地有据粗筛（25校、多城市每城10校），再由 `research-refine.ts` 按分数顺序只调查入选学校，最终目标10校。达到10所有据候选或单校目录/科目/学费/城市资料充分时提前停止，仍共享24搜索/60读取。`checkpoint.prefilter`保存完整评分与剔除原因，续跑复用；缺少粗筛快照的旧证据续跑及历史离线回放保留下文原5–10校流程。当前规则、真实数据缺口和零费用对比以[实施说明13.16](../../docs/实施说明.md#1316-任务二两阶段收窄)为准，覆盖下文相冲突的新报告调查顺序和数量描述。

模型能力集中在本目录，密钥和调用配置只在服务端。题库在 `knowledge/questions/`，学科目录在 `knowledge/disciplines/`，招生资料在 `knowledge/catalog/`，确定性评分和专业结论分别由 `server/assessment/`、`server/disciplines/` 负责。模型输出不会自动发布到知识库，也不能改变评分、报考资格或用户确认的专业。

## 当前联网报告 v7（history-first-v1）

现行新报告为 `profile-research-v7`，兼容旧版 `profile-research-v6` 及v3–v5；旧报告保持原快照。v7先按保存的需求建立最多6个调查方向，再合并模型补充线索。所有意向城市均检索招生单位清单，官网编码项目独立于模型进入候选；`demand-match-v1`固定排序，`programAlternatives`保留同校学位路线，`decisionBasis`记录测评快照与培养目标，`candidateAudit`说明逐校核验缺口。学位类型不推定数学／英语科目，示例小测不作为经标定的能力判断。当前分层、候选与年度资料流程以本节及[推荐方法与证据链](../../docs/recommendation-method.md)为准；旧报告需重新生成。

`referencePolicy.strategy='history-first-v1'` 保存目标年度、前三年参考年度及说明。目标2027时，2026／2025／2024各有独立检索机会，学校与年度轮询防止同校大量相似页面占满来源；2027单独检查停招、调整等变化，已知变更保留优先读取。每个项目的 `referenceBasis` 以最近可核验历史条目为比较基准；只有目标年资料时明确缺少历史基准，没有目标年资料时保留有据的历史参考建议，仍标目标年资格待核验。

`shared/research-years.ts` 识别实际正文中的明确招生、培养、考试与收费年份；`research-years.ts` 只在正文无年度且父页归属已验证时允许匿名附件继承明确年份。搜索标题、发布时间、读取时间或版权年份不能充当招生年度，多年度矛盾保持未知。`exams.historicalReference/history/historicalChanges` 分别保存最近历史初试组合、最多3个已核验历史年度及有据的同槽位变化；目标年科目独立核对，同年方向／学习方式／考试组冲突保持 `ambiguous`，不能借其他学位科目或把缺失科目解释为变化。历史资料不能覆盖已知目标年停招、报考条件、校区或收费冲突。

本轮历史策略验证使用模拟网络／模型集成、年度与费用／校区回归及已有公开官网资料的离线复核；本文末的历史提供商连通记录不代表新策略已完成真实收费服务或全国院校三年资料的端到端验收。

全流程最多24次搜索、60次官网读取。初期18次搜索、40次普通读取；意向城市恢复最多借用8次读取，实际专业和校区政策缺少地理证据时最多另补读2次、每校1次。地理链接可从任何学校已读官网发现，网址表不限制学校范围。其后费用阶段使用剩余额度、最多6次搜索和剩余读取槽位。初期、地理及费用阶段累计每校最多8次；80条搜索候选与最多24个同校HTML目录、PDF、工作簿新链接、最多3层发现。成功公开资料复用15分钟，失败不缓存，结构化事实优先，实际正文进入模型最多40项及40000输入字符。

XLS/XLSX显式启用`allowSpreadsheet`，同样遵守研究HTTP/同校有限跳转、公网DNS、固定IP与HTTPS的TLS校验。输入最多5MB，ZIP实际展开20MB、单项5MB、2000项、40表、4000行、64列、单元格8000字符及总文本200000字符；隐藏子进程5秒和128MB旧生代限制，仅必要环境，不执行公式、宏或外部链接。使用官方发行SheetJS 0.20.3。只有文件声明的单列纵向学院合并单元格可保留真实anchor范围值并标注来源，普通空格不自动继承。附件保留真实父页与链接，正文分别引用；子文年度与学校身份矛盾时不继承。培养城市须专业学院、同一招生年度校区政策和每个可能校区地址的证据链；历史链保留 `location.year` 作参考，不跨年拼接目录与政策，不能套用招生办地址或特殊人群政策，目标年实际安排仍须核对。

## 模块与接口边界

下表路径均以 `/api/v1` 为前缀。旧接口仍兼容；悬浮咨询使用新的持续对话接口。

| 模块与接口                                                | 当前行为                                                                                                   |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `index.ts` / `POST /assessment-attempts/:id/explanations` | 原有测评解释，限定本人、已交卷且适用的诊断；模型只能整理原解析、原答案与获准假设，输出严格校验。           |
| `web.ts` / `POST /assistant/questions`                    | 原有单次网页摘录接口；最多三条能在对应片段逐字找到的摘录及来源，失败时仍可展示已有来源。                   |
| `chat.ts` / `GET、POST、DELETE /assistant/conversation`   | 悬浮自由咨询，可提出任意主题、连续追问和清空记录；回答采用完整自然语言，不限定为三条摘录或固定问题个数。   |
| `chat.ts` / `POST /assessment-attempts/:id/tutor`         | 每题教学入口；作答中仅返回固定知识点提示，交卷后才提供本题解析与持续模型追问。                             |
| `guidance.ts` / `POST /guidance/:id/explanation`          | 整理已生成专业结论的有限依据；模型只选择、排序存在的依据 ID，最终文字由代码取回对应原文。                  |
| `research.ts` / `POST /guidance/:id/research`             | 独立联网研究报告：结合画像、公共课诊断与实际检索资料，使用思考模式生成带来源的事实、分析建议及待核验事项。 |
| `research.ts` / `POST /guidance/:id/research/supplement`  | 继续补查已有报告的逐专业缺项，复用公开原文与真实读取记录，在同一资源边界内更新证据。                       |

普通咨询的 HTTP 校验、所有权、会话与持久化在 `server/routes/assistant.ts`；研究任务、进度和报告持久化在 `server/routes/research.ts`。模型模块不接受前端指定提供商、密钥、系统提示词或任意工具。

## 逐专业资料覆盖、公共资料库与继续补查

`POST /api/v1/guidance/{guidanceRunId}/research/supplement` 使用同源 JSON，空请求体 `{}`，必须携带 `X-CSRF-Token` 与 `Idempotency-Key`。客户端不提交缺项、学校、报告或模型配置；服务端以本人已有报告及固定基础结论确定补查范围。无已有报告返回 409，失效会话、删除状态和版本变化先于幂等回放检查。相同幂等键和输入返回原任务最新状态；即使使用不同键，同一结论已有 queued/running 任务时也返回同一在途任务，生成和补查不会并行重复创建任务。

`ResearchJob.mode` 为 `generate/supplement`。补查 queued 响应携带上次基础报告（base report），`GET /guidance/:id/research/latest` 同样返回该基础报告，页面刷新、排队和运行时仍可阅读、导出已有内容。补查请求失败或任务失败保留历史报告与来源，并显示本次失败原因；不会用空失败结果覆盖已核对内容，也不自动付费重试。前端在提交请求和 queued/running 时禁用两个操作按钮；再次点击复用当前任务，用户结束后可显式重试。

`candidateAudit[].coverage.programs` 按具体专业身份记录目录代码、学院、学习形式及参考年度，分别给出 `program/exams/location/tuition/eligibility/curriculum` 六项状态：`supported_current/supported_reference/missing/ambiguous/not_applicable/excluded`。每项保留 `reason/sourceIds/references` 与实际原文年度。同校不同学院或学习形式不能互相继承事实，目录已有依据时不会因费用、考试或城市缺项把整校改成缺目录。历史依据只作为参考，资料覆盖状态不能代替资格核验。

`evidenceCoverage.strategy` 为 `program-evidence-v1`，包含学校/专业/已有专业依据/实质待补专业计数、`gaps/reusedSourceCount/supplementedSourceCount/lookupKeys/attempts`。缺项记录稳定 ID、专业与年度范围、优先级、原文引用、原因及下一动作；实际读取记录保留 URL、成功或失败、失败原因及尝试时间。低优先级的目标年度核对与实质缺证分开统计。数量仅统计本次实际调查，不代表全国院校资料已全部覆盖；未调查学校不作为排除依据。

公共资料库只保存符合来源与安全边界的官方公开正文、来源版本、真实获取时间和读取诊断，不保存个人画像、提示词或模型回答，也不自动写入正式招生知识库。时效检查决定能否复用，缓存命中保留原始获取时间。缺项修复按优先级和学校轮流补查，只使用实际观察到的学校域名、官方附件与定向查询；查询去重键和失败冷却记录跨补查保留。补查共享最多 24 次搜索、60 次正文读取及会话取消边界，不承诺一次补齐，不做无界重试。

| 模块                                                                            | 责任                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `shared/research-coverage.ts`                                                   | 定义六字段状态、逐专业原文引用、缺项与读取记录契约。                               |
| `server/explanation/research-coverage.ts`                                       | 按具体专业及适用原文计算覆盖、稳定缺项与有限范围计数；不决定推荐层级。             |
| `server/explanation/research-library.ts`                                        | SQLite 公共资料库，按学校、方向与年度复用来源版本及诊断，保留实际获取时间。        |
| `server/explanation/research-repair.ts`                                         | 执行有界缺项修复，按专业、字段、年度定向搜索和读取，保存真实失败记录。             |
| `server/explanation/research.ts`                                                | 调度资料复用、补查与报告核验，共享搜索/读取预算，输出更新后的逐专业覆盖。          |
| `server/routes/research.ts`                                                     | 核验会话、所有权和版本，处理 CSRF/幂等防重复、持久任务及失败后的基础报告保留。     |
| `src/workspace/ResearchEvidenceCoverage.tsx`、`src/workspace/ResearchPanel.tsx` | 展示具体原文、缺项与读取失败原因，继续补查及恢复基础报告，保持 Markdown 导出一致。 |

## 自由对话与逐题教学

`createGeneralChatModule(config).answer(...)` 接收当前消息和本人的对话上下文，支持一般知识、写作、讨论及继续追问。单条消息最多 3000 字符，发送给模型的最近历史累计最多 6000 字符；过长的旧上下文不再发送，不代表账号全部历史都进入模型。

自由对话保存在当前账号的 `assistant-conversation` 资源，使用 `If-Match` 防止覆盖其他页面的更新；记录超过约 250000 个 JSON 字符时，从最旧的一问一答开始裁剪。逐题历史独立保存为 `question-chat`，按测评与题号隔离，存储上限约 100000 个 JSON 字符。没有固定会话轮数上限，但仍受长度、预算和并发限制。清空对话会更换会话标识并阻止旧幂等回复恢复内容；登出、账号切换和个人资料删除会使在途旧请求失效。

逐题教学只从服务端已交卷快照读取题干、答案和固定解析，个人解题思路只有显式同意后才发送。答前提示不把答案发送给模型。交卷后的自然语言讲解可解释步骤、例子和公式，固定解析仍独立展示并作为评分依据；模型错误不会改写评分。模型关闭或不可用时，自由咨询说明真实原因，逐题教学回退到原解析。示例题和示例解析仍未经真实审校，模型讲解不改变其可信状态。

`src/workspace/TutorContent.tsx` 将结构化题库公式渲染为 MathML、结构数据渲染为固定 SVG，模型正文中的 LaTeX 使用 KaTeX。KaTeX 关闭 `trust`、限制扩展次数与尺寸、逐段创建宏环境；其余正文作为文本展示，不透传模型 HTML。格式及扩建要求见 `knowledge/questions/README.md`。

## 按需搜索与来源

自由对话在用户允许联网且服务端配置可用时，先用受限 JSON 请求判断是否需要实时搜索；一般知识和闲聊可以不搜索。需要时使用具体检索词调用一次已配置的搜索服务，再把实际资料交给自然语言回答步骤。也可提供最多两个官方资料 URL；提供 URL 本身表示请求读取该页面，不依赖搜索开关。逐题教学按固定题目依据回答，不自动调用网页搜索。

官网读取复用 `web.ts`：允许主机名由服务端 `allowedHosts` 或 `YANTU_OFFICIAL_HOSTS` 精确配置，用户不能扩展。普通咨询与用户自填网址仍只用 HTTPS、不跟随跳转；研究流程显式设置 `maxRedirects:3`、`allowHttp:true`，只对 `.edu.cn` 放行明文HTTP。同校跳转限同一学校注册域名最多3次，每跳重新做全部DNS公网校验并固定连接IP，HTTPS保留TLS主机校验；跨校跳转拒绝，私网、IP直连、凭据、显式端口、大小与时间上限继续拦截。

应用默认 `YANTU_SEARCH_PROVIDER=bocha`，启用需 `YANTU_SEARCH_ENABLED=true` 与 `BOCHA_API_KEY`。`search.ts` 将博查与Brave协议归一到同一结果类型；博查只请求固定 `POST https://api.bocha.cn/v1/web-search`，Bearer认证，返回摘要仍标为 `search_snippet`，不因供应商字段名为summary就视为官网原文。显式设置 `brave` 时仅使用 `BRAVE_SEARCH_API_KEY` 请求固定Brave主机；不自动回退、混用密钥或跨域发送凭据。直接模块旧调用未指定provider时保留Brave兼容，应用入口总会明确选择供应商。接口依据见[博查官方文档](https://bocha-ai.feishu.cn/wiki/RXEOw02rFiwzGSkd9mUcqoeAnNK)。

普通问答默认最多五条摘要；仅服务端研究可通过第二参数 `options.search` 请求最多十条，不自动抓取任意搜索结果页面；HTTP失败、供应商业务错误码或无效结构不会标记搜索成功。来源含原始URL、标题、摘录、检索时间以及 `official_page` / `search_snippet` 类型。所有网页资料保持 `verified:false`，不会自动成为已核验招生事实。

旧 `/assistant/questions` 校验摘录与原片段逐字一致；新自由回答仅校验约定格式的来源编号是否属于本次实际资料，并明确是否取得可引用网页。**存在来源或通过引用检查，不等于自然语言回答中的所有推论、时效信息或公式均已验证正确。** 仍应按原文核对适用年份、上下文和报考条件，不能将自由回答宣传为准确性保证。没有资料时要求模型说明不确定，不得假称已检索。网页、用户输入和历史文本均按不可信数据处理；提示词约束不能替代事实审核。

仅研究内部调用 `web.answer(input, {sourcesOnly:true, search:{includeDomains, count}})` 可指定结果数量与具体学校域名，HTTP请求不接受这些参数。`count` 为1–10整数、默认5，`includeDomains` 最多10个具体根域名或子域名；协议、路径、端口、IP、通配符及裸 `edu.cn` 等范围拒绝。博查使用原生 `include`，Brave由适配器生成 `site:` 查询；返回结果再检查根域或子域边界，不因此扩展网页读取白名单。博查官方文档确认原生域名参数，未承诺 `site:` 或公共后缀 `edu.cn` 的过滤语义，不能把它们当作已经生效的硬限制；具体参数见[官方请求体](https://bocha-ai.feishu.cn/wiki/RXEOw02rFiwzGSkd9mUcqoeAnNK#Jnksd9YtNoMoNjxgK1wchorBncc)。非法内部选项在扣次数或任何请求前拒绝，失败不自动换服务或重试。

## 专业结论的受控解释

`createGuidanceExplainer(runtime).explain(owner, run)` 只处理服务端保存的 `GuidanceRun`。路由在调用前和异步完成后检查本人所有权与当前画像、专业选择、学科目录、规则及引用测评版本；过期或撤回依据不能继续生成或重放解释。

模块从确定性结论、考虑因素、建议比较方向的理由和测评观察中提取最多 24 条去重依据。模型只能返回现有、非重复的依据 ID；代码按 ID 输出原文并附上原有限制。它不生成专业适配分、录取概率、资格结论或新的招生事实，也不把示例题表现升级为正式推荐证据。模型失败时保留规则原文。

## 独立联网研究报告

`createResearchReportModule(config, { runtime, web })` 与旧 `createGuidanceExplainer` 是不同任务。其 `generate({ subjectId, run, selectedProgram?, onProgress? })` 基于服务端保存的 `GuidanceRun` 工作，输出 `ResearchReport`，不再只选择旧依据 ID。模型可以结合个人约束与实际网页资料分析准备成本、比较方向并提出行动建议；确定性评分、正式资格和用户确认专业保持由业务模块管理。

模型先收到全国184条基础目录及完整任务画像：本科专业与院校、兴趣、职业目标、城市、预算、跨专业意愿、学位偏好、七项优先级、可投入时间、课程与备考情况，以及适用公共课诊断统计、薄弱点和局限。`notes` 自由补充最多前3000字符；姓名、原始题库和未交卷答案不发送。本科院校只作用户自述背景，不推断学校层次或录取率。方向规划不能被本科专业或旧结论高亮项锁定，尊重明确拒绝与未知项。公开检索词只含年度、规划后的公开专业方向、城市偏好及可选目标学校，不含姓名、本科院校、原始补充或完整画像。

研究分两个模型阶段：规划使用所选模型非思考模式（默认Pro，4096输出token/30秒），最终以Pro/high分析（默认16384输出token、45秒空闲超时/默认300秒总上限，含思考）。规划保留184目录、当前profileEvidence及结构化偏好，长notes/courses按需裁剪使输入不超过15000字符。模型阶段、修复与临时HTTP重试均使用同一runtime；搜索以sourcesOnly取证据，不额外调用摘录模型。官网读取权限与SSRF限制不变，普通HTML/文本仍限8秒、512000字节，PDF另有受控限制。

研究内部可显式传 `options.upgradeAcademicHttp:true`，仅在 `sourcesOnly:true` 时保留实际搜索结果中的 `http://*.edu.cn` 原始地址作为读取候选；该历史选项名现在表示允许保留教育网HTTP链接。`WebSource.retrievalNote` 记录待核验线索说明。普通聊天与用户直接提供的URL不启用，客户端不能传此内部选项；凭据、显式端口（包括80）、IP、非教育网域名和歧义URL拒绝。研究会按原始HTTP地址读取，允许同校升级到HTTPS；搜索摘要仍不是官网正文。明文成功读取保存 `transport:"http"`，并展示“明文传输（HTTP）读取，内容可能被网络中间环节篡改，仅作待核验线索”。原始url继续保留，有跳转另存finalUrl；资料库复用与报告导出保留传输方式及提示。

当前预算与并发读取、模型输入、额度计算见本文件“阶段5统一预算与诊断”。搜索仍跨方向轮流发现学校，每方向4–6个 searchSchools 仅为检索线索，按校名＋专业＋硕士检索，并从已观察主机提取最多两个具体学校根域。成功公开结果15分钟复用，失败不缓存。

当前报告以5–10所不同学校为目标，每校保留一个主推荐专业，同校其他专业与学位路线放入 `programAlternatives`。`demand-match-v1` 按完整画像分为 `preferred`（第一级·优先推荐）、`alternative`（第二级·适合备选）和 `exploratory`（第三级·探索选择）：方向关联、培养路线及已核验城市决定优先比较，服务端生成 `tier/tierReasons`，模型的 `suitabilityTier/suitabilityReason` 不能改变服务端层级。费用只是一个因素，同费用学校可以不同层，较贵但其他方面高度契合也可优先，须明确费用缺口。预算/城市通过 `constraintChecks` 标明 `match/mismatch/unknown`，历史比较注明年度和目标年待核验原因，未知不能当成满足；有城市偏好时，城市未知不满足优先比较条件。优先推荐不等于录取率、录取保证或报考合格。明确不跨专业、已排除方向、停招及目标年度资格硬冲突不能通过备选层放宽。不足5所时保留真实卡片并返回partial，`coverage` 展示已覆盖学校数、分层数量及具体缺口，不宣称全国无校、不按同校多专业凑数量。

学费只通过 `tuition` 结构化证据表达：amount、CNY、period（academic_year/program/semester/credit）、year、studyMode（full_time/part_time/unspecified）、连续原文quote和sourceId。必须来自该校所引官网，绑定具体项目、明确年度、学习形式、计费单位及唯一费用金额；学校一般收费、别的专业或非全日制费用不能套用。历史费用在 `academic_year` 且学习方式明确时可与年度预算作带年份的参考比较，原因同时保留原年度与目标年度收费待核对提示，不称为本年价格；目标年费用或冲突优先核验，不能借历史低价避开冲突。全程/学期/学分费用或未知学习形式不能直接与用户年度预算比较，不按学制擅自年化；住宿和生活总成本仍待核验。城市需所引官网的实际培养校区地址原文 `location`，或同年度专业—学院—政策—校区地理证据链；历史链注明 `year` 和目标年待核对原因，不凭学校名称猜所在地，也不跨年拼接培养政策。条件检查由 `research-constraints.ts` 负责，模型不能以自报结果代替constraintChecks；分层由固定需求规则产生，不由单一费用检查决定。

`research-evidence.ts` 将停招与本科限制绑定到具体专业的代码/句段，不能因目录中相邻专业停招或限招而排除当前专业；归属不清时保持待核验，明确学校整体停招仍拒绝。压缩长正文时保留实际学校标识、具体专业代码和邻近原文，不能用搜索标题补造校名。专业关联仍须通过官网正文核对，历史条件与目标年度条件分别处理。

研究显式启用 `WebReader.allowPdf:true` 与 `maxPdfBytes:5000000`，普通问答默认false。PDF下载仍须通过上述研究HTTP及同校有限跳转、全DNS公网、IP固定和HTTPS的TLS检查，仅PDF下载及解析输入最多5000000字节；HTML/JSON/text仍为研究512000字节、reader全局1000000字节。研究下载限8秒、reader全局10秒，并同时校验 `application/pdf` 与 `%PDF` 文件头。`pdf-text.ts` / `pdf-text-worker.ts` 使用 `pdf-parse@2.4.5` 在独立隐藏Node子进程提取纯文本，解析另限5秒、80页、120000字符，超限整项拒绝，不做OCR。子进程固定参数与128MB旧生代/16MB新生代，仅保留必要SystemRoot，不传密钥、`.env` 或 `NODE_OPTIONS`；禁PDF内JS求值、外联fetch、XFA和渲染，字体/CMap仅用本地依赖，超时终止。它提供解析隔离与资源限制，不是完整操作系统沙箱。无效、超时、超页/字符、无文本分别为 `WEB_PDF_INVALID/TIMEOUT/TOO_MANY_PAGES/TEXT_TOO_LARGE/EMPTY`，保留搜索摘要和失败原因，证据不足为partial；不能把PDF解析失败归因于招生年份缺失。

意向城市单独验收：单个城市按方向循环使用，不因方向序号丢失；学校域名须来自实际学校主体标识，不能把其他学校页面中提及的导师母校当域名归属。同校不同专业保留检索机会，读页优先补齐本地项目。模型省略location时，仅从引用官网的唯一同校地址或明确同校同项目培养地址恢复，不用摘要、合作单位地址、多校区冲突或学校名称猜测城市。正向城市声明必须与核验结果一致，不能把上海说成符合杭州偏好，也不能擅自认定用户接受长三角通勤。同一综合推荐层级内，已核验符合意向城市的学校优先；不降低资格、专业关联或证据门槛凑本地学校。

`coverage` 可增加 `preferredCities`、`preferredCitySchoolCount`、`unknownCitySchoolCount`；城市未知不计入匹配。已有5校但城市匹配为0，仍为partial并显示意向城市缺口；无其他校验失败时使用 `PREFERRED_CITY_COVERAGE_INCOMPLETE`，其他失败码保留且同时展示城市缺口。有实际本地硕士项目与地址线索时，可与原数量补充共用最多一次覆盖分析，不增加模型请求上限；保留已有建议，但同校可换成有据本地项目，10校已满时可用首个有据本地候选替换末位外地项，摘要同步更新。未取得城市证据时不会为凑数量虚构校区，也不宣称杭州没有适合的学校。历史报告保留原内容，需重新生成才使用本轮规则。

`facts` 只接受引用来源中的连续原文摘录，每条最多300字符；前三年历史资料保留原年份，不升级为目标年事实。新报告保持 `schemaVersion:1`、`reportVersion:profile-research-v7`（兼容旧 `profile-research-v6` 等报告）、`researchDirections[]`（disciplineCode、name、rationale）及 `followUpQuestions[]`，并增加 `referencePolicy`；建议包含 `programName`、全国目录派生 `degreeType`、`fitReasons[]`（profileField、profileValue、reason）、`tradeoffs[]`、`admissionStatus`、可用时的 `referenceBasis` 与逐年科目证据。每项新建议至少包含两个不同真实画像字段的理由，画像值必须对应本次固定输入；学校及具体专业必须有实际学校官网关联依据，专业代码属于规划方向或已读官网发现且当前画像硬约束允许的全国目录方向，不能把任意学校与国家目录类别拼在一起。核心学校身份、具体硕士专业、引用及综合理由必须通过；局部无据条目可移除，但之后仍须至少两个有效且不同的真实画像维度和至少一项有效取舍，否则整项建议剔除。不得为保留数量降低证据要求。匹配理由、准备、取舍和待核验条目按项检查；删除局部无据内容后仍保留合格建议，并标partial说明删减。URL只来自实际来源；无据数字费用、分数、概率和明确资格断言拒绝。来源含URL、标题、摘录、读取时间与层级，保持 `verified:false`；结构检查不等于所有推论正确。

v6规划与最终报告均以字段引用生成匹配理由：模型输出 `profileField` 与 `reason`，服务端从本次已保存画像快照补入 `profileValue`。提供给模型的 `profileEvidence` 只列当前可用字段，排除空值、不确定项、已清空notes和默认中性优先级50；多个优先级仍只算一个维度。旧格式显式提供 `profileValue` 时继续严格核验当前原值，数值优先级与城市数组只按实际字段类型规范化，不能借规范化改写偏好、增加城市或恢复旧备注。单条可选理由不合格时隔离该条；仍有至少两个不同真实画像维度且不只包含本科背景时保留方向或建议，不足时汇总字段问题供一次有界修复。字段绑定不意味着自由文本理由的所有推断都已获事实证明。

适合度建议与目标年度资格核验独立。历史、年度不明或混合年度的真实学校官网，只要明确支持校专业关联，仍可支持条件性建议，服务端将 `admissionStatus` 设为 `needs_verification`。目标年度确在学校正文招生语境出现才可为 `current_evidence`，但也不等于eligible；搜索标题、读取时间和版权年份不能替代。旧资格、学费、名额和分数不升级为本年事实。明确示例/测试资料、停招或没有校专业关联的建议仍拒绝；学校名中含“示例”不等于示例资料标记。专业否定语境保守处理，不声称全面语义核验。允许否定性的“无法预测录取概率”“不保证录取”，肯定保录或具体概率仍拒绝。

学校与专业的关联还须对应硕士层次，不能仅凭本科或博士资料推荐硕士项目。目标年度官方背景限制与用户明确冲突时剔除该项，历史条件只作待核验风险。无费用依据不判定超预算；错误按事实/建议逐项隔离，保留其他合格结果，不为凑数量放宽证据检查。

状态含义如下：

规划失败可附带 `validationIssues:[{path,code}]`，仅保存服务端校验器产生的固定字段路径与错误代码，便于区分失败位置；不保存画像值、原始模型回复或内部思考。该诊断归属本人报告，不作为页面匹配理由，也不能据此宣称已完成联网。

24次搜索预算内，首个学校线索无结果时，下一次使用该校的硕士培养方案查询补证，再继续其他学校。来源排序以硕士项目相关性优先：博士生/博士后招生、导师审核、录取通知和普通首页降序，低相关页面不能仅凭新学校域名挤占实际硕士资料；这些页面仍可保留为来源，但不消耗有限的正文读取槽位。

- `blocked`：模型或搜索未配置、尚无研究方向，或未获得真实联网来源；不会把模板冒充调研报告。
- `partial`：只有摘要或公共平台资料、没有支持校专业关联的学校官网正文，或者证据不足、模型额度不足、超时及输出校验失败。已有来源可保留，未通过校验的内容不展示；目标年度未知本身不清空有据的条件性建议。
- `completed`：本次有界适合建议流程完成，建议有实际校专业官网依据且画像理由通过校验；可含年度待核验的建议，不等于全国覆盖、资格已核实或录取保证。

模块按实际执行回调 `preparing`、`researching`、`analyzing`、`writing`，每次都等待 `onProgress` 完成。无网页证据在进入 `analyzing` 前结束；检索后、模型调用前及返回前的回调允许路由取消过期会话、变化的画像版本或已删除数据。`writing` 表示整理本次生成结果，不是伪造的流式 token 进度。回调异常不会被吞成普通模型降级。

`GET /research/status` 返回本地配置检查 `{ready,reasons,model}`，不发付费请求。`POST /guidance/:id/research` 创建任务；`GET /research-jobs/:id` 查询真实阶段与结果，`GET /guidance/:id/research/latest` 恢复最近任务。任务层另有排队、运行、失败、取消状态；报告状态与任务生命周期分开。

## 提供商、预算与故障

`deepseek.ts` 仅使用 DeepSeek 官方 HTTPS 接口。普通聊天默认 `deepseek-flash`、关闭 thinking、非流式响应和最多 30 秒超时；独立研究默认 `deepseek-v4-pro`、`thinking.type=enabled`、`reasoning_effort=high`，45秒空闲超时及默认300秒总上限。模型和思考强度由服务端任务选择，不接受浏览器覆盖。官方模型名和参数见 [Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)；模型供应及别名以[官方模型说明](https://api-docs.deepseek.com/quick_start/pricing/)为准，不能仅凭 Pro 名称保证质量更高。

| 请求用途                                 | 格式              | 当前最大输出 token                                |
| ---------------------------------------- | ----------------- | ------------------------------------------------- |
| 旧测评解释、旧网页摘录、专业结论依据整理 | JSON              | 800                                               |
| 自由对话是否需要搜索的判断               | JSON              | 400                                               |
| 自由对话与交卷后的逐题追问               | 自然语言文本      | 2000                                              |
| 研究方向规划                             | JSON + 非思考模式 | 4096，最多30秒                                    |
| 最终联网研究报告                         | JSON + 思考模式   | 默认16384（含思考输出），45秒空闲/默认300秒总上限 |

800 是默认值，不是所有调用的统一上限。服务端输出配置须为 1–16384 的整数；输入上限为普通请求 16000、思考请求 40000 个 JSON 字符，非流式响应字节上限为65536，思考流式响应采用下述分层上限。超大响应、非正常结束、未知 token 用量和未经请求的工具调用均拒绝；适配器不自动重试、不在失败时自动换模型、禁止重定向。响应只返回最终正文及总用量，不暴露或保存供应商的隐藏思考内容。模型启用需 `YANTU_MODEL_ENABLED=true` 和服务端 `DEEPSEEK_API_KEY`，不能使用 `VITE_` 环境变量或前端请求体传递密钥。

研究最终分析配置为 `YANTU_RESEARCH_MODEL`（默认 `deepseek-v4-pro`，也支持 `deepseek-flash`）、`YANTU_RESEARCH_EFFORT`（默认 `high`，允许 `low/high/max`）、`YANTU_RESEARCH_TIMEOUT_MS`（总上限默认300000毫秒，允许1–1800000整数，实际不超过整份报告剩余时限）、`YANTU_RESEARCH_MAX_OUTPUT_TOKENS`（默认及上限16384）。规划复用所选模型，固定非思考4096输出token/30秒。应用每账号100000token日额度仍可能因已有消费或重试不足以预留完整流程，应设置可承担预算；不足时返回原因，不跳过规划冒充完成。

`research-generation.ts` 通过同一 `ModelRuntime` 运行规划与最终报告。每阶段结构、引用或画像校验失败且取得模型正文时最多修复一次；确认收到HTTP 500/502/503/504时，整份报告的规划与最终调用共用最多一次临时重试，退避250毫秒后通过 `beforeRetry` 再查会话、画像版本和取消状态，并以新retry键重新预留同一额度。规划与初次报告每阶段最多3次模型请求；少于5校且已有至少5个学校官网根域和5个校名线索时，最多再用一次同账本分析补充遗漏候选，不修复、不重试，不超过10校且保留已有建议。整份报告最多6次模型请求，预算不足保留已有建议并说明原因；不是保证会调用到上限。适配器自身不重试，不切换模型或供应商。网络错误、超时、认证、余额不足、限流、输出截断和取消不自动重试。校验修复只携带原始画像、目录、证据与最多六条内部字段问题；近上限时去掉无效旧回答，不裁掉原始证据。未知上游用量保留预留额度，超时不等于免费。

错误原因按安全状态分类：400/422为 `PROVIDER_INVALID_REQUEST`，401/403为 `PROVIDER_AUTH_FAILED`，402为 `PROVIDER_BALANCE_INSUFFICIENT`，429为 `RATE_LIMITED`，500/502/503/504为 `PROVIDER_TEMPORARY_UNAVAILABLE`，连接失败/中断为 `PROVIDER_NETWORK_ERROR`，本地超时为 `MODEL_TIMEOUT`，成功HTTP但非法JSON/SSE为 `INVALID_RESPONSE`；响应超限为 `RESPONSE_TOO_LARGE`、非正常结束为 `INCOMPLETE_RESPONSE`、用量缺失或非法为 `UNKNOWN_USAGE`，均明确解释模型输出故障，无需修改画像。未归类HTTP保留 `PROVIDER_UNAVAILABLE`。页面解释基础设施原因，不要求用户重填画像；不读取或展示上游错误正文、认证头和密钥。分类依据见[DeepSeek错误码](https://api-docs.deepseek.com/quick_start/error_codes/)，502/504按临时网关错误处理。

`failureStage` 可选值为 `preparing/researching/analyzing/writing`，表示失败发生的真实阶段；阶段失败、模型输出校验失败和用户信息不足分别解释。已保存画像充分但模型格式错误时，不提示用户必须先选学校或重新填写画像；只有实际画像不足或有效规划中的明确追问才请求补充。

研究思考请求使用 `stream:true` 与 `stream_options.include_usage:true`，非思考请求保持非流式JSON。`deepseek.ts` 在服务端增量解析SSE，只累计最终 `delta.content`，不累计、展示或记录 `reasoning_content`；支持字节/中文分片、多行data、CR/LF及独立或随stop返回的用量。必须取得 `[DONE]`、`finish_reason:stop`、匹配模型和完整usage，拒绝工具调用、截断、未知用量及异常结构；完整completion_tokens包含思考。空闲超时为45秒，从请求发出开始计时，每批非空字节（包括推理、心跳和未完整成帧的数据）重置；默认总上限300秒，可通过 `YANTU_RESEARCH_TIMEOUT_MS` 调整为1–1800000毫秒，但实际不超过整份报告剩余时限。持续有数据只延长空闲计时，心跳不延长总截止时间。全部SSE响应（含思考和协议帧）最多8388608字节（8MiB），单事件或未结束行最多65536字节（64KiB），最终content累计最多131072字节（128KiB），心跳不延长截止时间，DONE后取消剩余连接。失败仍保留预留额度，不因网络结局不明自动重试。依据[DeepSeek流式接口](https://api-docs.deepseek.com/api/create-chat-completion/)与[思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。流式传输可减少长时间静默等待，不保证解决DNS或连接故障。

应用默认每账号每日300000、全站900000模型token，并发分别1和4；直接创建 `ModelRuntime` 时采用同一组默认值。调用前按输入字符和最大输出预留，实际输入及总输出（含思考）结算。研究、解释、咨询和修复共用账本，不能绕过额度；搜索另由共享 `createSearchBudget` 计量，应用默认每账号每日60次、全站300次，发送前计数且失败不退还。环境变量为 `YANTU_MODEL_USER_DAILY_TOKENS`、`YANTU_MODEL_DAILY_TOKENS`、`YANTU_SEARCH_USER_DAILY_REQUESTS`、`YANTU_SEARCH_DAILY_REQUESTS`；搜索次数不等于报告份数。这些数值是应用本地token上限，不是供应商账户余额或充值。账本是单进程内存、重启重置，不构成长久或跨实例账单硬上限。

缓存带账号、任务、依据或对话内容、提示版本、模型配置与请求选项，最长 24 小时、最多 1000 项。`clearSubject` 清除相关私有缓存并提升清除代次；路由还在异步返回及持久化前核对账号会话和个人数据代次，防止删除、清空或登出前的请求写回旧数据。预算、并发预留与缓存目前位于单进程；重启不会保留日额度计数，多进程部署必须先改为共享事务存储，不能将现有额度声明为跨实例硬性限额。

代理Fake-IP网络可显式配置 `YANTU_DNS_MODE=public-doh`，默认仍为 `system`。`dns.ts` 将固定阿里云HTTPS DNS响应归一为地址列表，限制超时、大小、问题主机和CNAME链；`web.ts`继续检查所有地址并固定连接IP、TLS主机，不回退、不放行内网或虚拟地址。普通公网教育网IPv6与`2001::/23`等特殊范围区分，避免误拒双栈高校官网。

模型与网页读取共用服务端 `YANTU_DNS_MODE` 配置。`system` 保留原生fetch；`public-doh` 时 `deepseek-transport.ts` 只向固定 `api.deepseek.com` 的允许路径POST，复用固定阿里HTTPS DoH和 `public-address.ts` 全公网校验，优先已验证IPv4并以lookup固定IP；保持SNI、`rejectUnauthorized:true`、禁止重定向和原AbortSignal，不回退、不重试、不转发凭据给DNS。响应以受取消保护的按需流桥接交给同一JSON/SSE解析器。模型请求体最多131072字节，以容纳合法40000字符中文输入，不提高模型字符上限。DoH服务自身仍可能受系统解析或外部网络影响，未硬编码未经证实的bootstrapIP，不保证持续连通。

扩展模型提供商只修改适配器；搜索协议与预算在 `search.ts`，安全读取在 `web.ts`，完整画像、方向规划与画像理由校验在 `research-planning.ts`，有界候选发现、观察官网域名后的补证与跨方向/学校来源选取在 `research-search.ts`，项目局部条件与原文保留在 `research-evidence.ts`，有界格式修复在 `research-generation.ts`，报告协调及输出核验在 `research.ts`，自然对话在 `chat.ts`，固定依据整理在 `guidance.ts`。知识内容继续走各 `knowledge/` 目录的审核发布流程。普通测试使用模拟适配器和网络，不产生模型或搜索费用：

```sh
node --test tests/backend/explanation.test.ts tests/backend/explanation-web.test.ts tests/backend/guidance-explanation.test.ts tests/backend/tutor-chat.test.ts tests/backend/research-report.test.ts
npx playwright test tests/tutor-chat.spec.ts
```

2026-09-27已真实验证DeepSeek模型列表、Flash短生成，以及博查搜索、官网读取和Pro/high分析连通，使用合成画像。当日v3复用此前已验证规划、六次真实搜索响应和四份已取得官网正文，进行一次新的Pro/high分析并对原响应离线复核，保留上海师范大学课程与教学论、教育学原理两项学术0401建议；结果为`partial/RESEARCH_PARTIAL_VALIDATION`，十二项来源中四项为官网正文，两项建议均为`needs_verification`。这是保留真实证据后的再分析，不是全新端到端搜索。真实短PDF中文提取已成功，关键培养方案PDF仍因下载超时未取得正文。局部无据说明和无官网专业依据的候选已移除；不能把这些局限归因于目标年度未公布，也不代表全国覆盖、当年资格或整体推荐质量已验收。自动化回归使用模拟供应商响应，与真实调用分开记录。凭据只存于Git忽略的本地 `.env`，本文不记录其值；普通测试不进行真实收费请求。

2026-10-03后续v5修复：用户清空备注并保存后，失败任务已绑定新画像版本4，说明保存已生效，不能归因为旧缓存。该任务仅持久化 `UNGROUNDED_PROFILE_FIT`，未保存原始模型回答，不能断定是哪一字段触发；同画像随后单次重新请求规划通过，说明校验存在稳定性问题，不能据此宣称整份报告已通过。本次改为服务端绑定当前画像值、过滤不可用字段并隔离单条无效理由；历史学校建议不是本次v5真实生成结果。

2026-10-04 v6修订记录：目标5–10所不同学校与综合画像三层比较，新增项目/年度/单位/形式一致的学费证据和城市检查，24次搜索、40候选来源、24官网读取及15分钟公开资料复用。最新旧v5任务仅记录PROVIDER_UNAVAILABLE，不能据此确定实际HTTP状态或网络原因；新版本已区分安全错误码并对确认临时HTTP故障限制一次计额重试。此前传输分类及重试专项26项模拟回归通过，该项测试不发付费调用；v6学校覆盖、费用质量及真实端到端结果尚待独立验收，不能用上面的历史结果代替。

最新public-doh与SSE真实调用及保留证据离线复核结果，见[实施说明最新验收记录](../../docs/实施说明.md)；链路连通不代表已满足5–10校覆盖、学费证据或推荐整体质量门槛。

阶段1读取层已实现：

- `registrableDomain(host)` 对edu.cn/com.cn/org.cn/gov.cn/ac.cn/net.cn取后三段，其余取后两段。跳转目标须同注册域名，且是精确allowedHosts主机或教育网主机；超过3跳或循环报WEB_REDIRECT_LIMIT，跨校报WEB_REDIRECT_CROSS_SITE。默认maxRedirects为0、allowHttp为false；请求凭据不转发到跳转目标或HTTP。
- 相对HTML链接以finalUrl为基准；url仍是原始来源。HTTP→HTTPS或允许的HTTPS→HTTP链只要出现明文，transport记为http；成功来源展示明文传输提示，始终verified:false，不自动发布到正式目录。
- 编码按BOM、Content-Type charset、前4096字节meta、UTF-8的顺序识别。GBK/GB18030别名统一按gb18030，支持big5；未知声明回退UTF-8。无声明且UTF-8替换字符超过1%时，仅在gb18030替换字符更少时采用回退。
- 请求Accept-Encoding为gzip/deflate/br；压缩下载与解压输出分别受同类型上限约束，HTML研究512000字节，PDF及工作簿5000000字节。解压超限报WEB_TOO_LARGE，损坏报WEB_DECODE_FAILED，未知压缩格式拒绝。下载整条跳转链共享8秒，解析仍受独立进程限制。
- 细分读取失败码包含HTTP_403/404/410/429/4XX/500/502/503/504/5XX、WEB_TLS_CERT、WEB_CONNECTION_RESET、WEB_CONNECTION_REFUSED；证书错误只保留安全tlsCode，继续验证证书，不放宽rejectUnauthorized。DNS专用失败码同样保留。补查冷却按全部失败记录执行，失败不覆盖成功证据。
- 请求User-Agent为Mozilla/5.0 (compatible; YantuEvidence/1.1)，Accept-Language为zh-CN,zh;q=0.9。不伪装具体浏览器版本。
- 免费脚本 `scripts/probe-school-sites.mjs` 接受每行一个URL的文件或 `--urls URL ...`，最多4并发、同主机串行，遵守YANTU_DNS_MODE；不加载.env、不调用模型或搜索，输出成功/失败码/tlsCode/finalUrl/transport/encoding与汇总。

## 阶段2校验、绑定与诊断（已实现）

阶段2对应 R-33 / T-27。普通无据句子只删除该句，六类说明字段按 `。；;！？!?` 与换行逐句校验；空 rationale 使用通过的 fitReasons 回退。城市 unknown/mismatch 时，符合城市偏好及无据跨城通勤说法必须移除。学校身份、官网硕士项目、允许学科、明确停招／资格冲突、至少两个不同真实画像维度、至少一项有效取舍仍是硬门槛；价格、概率和确定资格等核心断言拒绝整条。`reportMessages` 为每个候选提供城市 match/mismatch/unknown 及依据，未知不能声称符合城市偏好。

`research-binding.ts` 在模型分析后，从同校注册域名全部已读正文绑定 exams/tuition/location，追加 citations，并重新计算 constraintChecks；最终层级仍由 demand-match-v1 决定。`research-program-scope.ts` 统一代码行的学院及学习方式边界。附件仍验证真实父页链接与同校归属，历史字段保留年度，目标年度冲突优先，全程／学期／学分不年化，特殊人群与合作单位地址不套用。不能唯一归属的相关连续原文进入 `pendingEvidence:[{field,quote,sourceId,year?,reason}]`，quote≤300字，页面显示“待确认原文”，不用于预算或城市匹配。

`research-school.ts` 的可替换 `InstitutionResolver` 在阶段3优先使用种子库注册域名和正式校名；未知学校用已读正文校名主体、标题与版权所有者回退。学院归一后保留 collegeName，学校本身的名称、旧名和别名不会成为学院。无法归一和非专业栏目名作废。身份缓存随实际正文、标题和来源状态变化失效，不缓存个人画像；域名识别仍不能替代正文学校身份及硕士语境核验。

报告通过 `server/routes/research.ts` 保存 `rejectedRecommendations:[{institutionName,programName,code,removedSentences}]`、`validationIssues:[{path,code}]`、`readStatistics:{success,failed,failuresByCode}`，本人可从 `GET /api/v1/research-jobs/:id` 读回；补查失败保留旧报告时同步本次诊断。removedSentences=0表示整条拒绝，正数为删除句数；不保存模型全文或被删句子全文。读取失败只按实际尝试计数，内外层捕获同一次失败不重复计入；Markdown“技术信息”列出计数，诊断暂不在页面展示。

阶段2审查修正：明确全校口径的单一费率可绑定，tuition.scope 为 school_wide（全校统一标准）或 school_wide_mode（按已确认学习方式）。历史年度保留；学校费率无适用年度时 year 可缺失，预算保持unknown。专业分项、特殊人群及目标年度冲突仍核验，全程／学期／学分不年化。`research-tuition-passages.ts` 提供连续学费金额条目及规范化去重键；待确认原文不收辅助费用、标题和纯联系方式，reason 说明具体方式、金额、校区、年度或范围问题。

## 阶段3全国院校种子库

[registry.json](../../knowledge/schools/registry.json) 收录458校、31个省级行政区，含全部147所第二轮双一流。server/schools 启动时校验名称、别名、注册域名、省市、URL及核验摘要。按城市、主机及别名查询均返回 discoveryOnly: true；城市匹配区分 main 与 campus_hint，不能把种子或网页可读性当成招生事实。原杭州5校具体招生与地理导航全部保留。

每个意向城市最多12条稳定线索，双一流优先、随后按校名排序；学校级 includeDomains 优先使用种子根域，库外学校沿用真实网页观察。已观察专业来源优先，直接种子导航最多6次，不占用意向城市恢复槽位。初期18次、总24次搜索与24次总读取、初期每校4次及后续每校6次上限不变。

城市级校区核验要求该校在种子库中且没有跨城 campusHints，本次读到的学校实际地址全部同城且可识别；仅确认城市，具体校区仍待专业安排。跨城提示、多城市地址和库外学校继续使用专业级证据。带街道门牌的办学地址即使含电话、邮编也保留；不能绑定时展示待确认原文，纯电话／邮编／邮箱继续排除。

免费核验脚本 scripts/verify-school-registry.mjs 支持 --province/--city/--limit/--write，复用公网DNS、固定IP、TLS、编码识别和最多3跳的同校安全 reader。全局并发≤6、同域串行、间隔至少1秒、单次10秒；不加载 .env，不调用模型或付费搜索。资料负责人维护、部署方每月及发布前复核（D-13），操作见 [种子库说明](../../knowledge/schools/README.md)。

## 阶段4公共事实库与资料库优先

`research-library.ts` 统一拥有原文与 `research_program_facts` 的读写接口。`save(WebSource)` 内部调用 `research-facts.ts`，复用 `research-matching.ts` 的 `programEntries`、阶段2 `bindRecommendationEvidence`、招生范围与年度校验，不接收模型事实或推荐作为写入输入。已有原文在首次迁移时确定性回填。事实始终 `verified:false`，学院与招生单位分开；`school_wide`、`school_wide_mode` 和城市级校区核验的语义保留。

事实按完整项目身份、字段与来源版本保存；不同来源、不同年度都保留，同一来源新读取只替换自己的旧事实。失败不删除已存证据。目标年度、历史、未标年度的复核期限分别为1、30、7天，`queryFacts()` 返回 fresh/stale 与 targetYearApplicable，过期及未标年度不能作为目标年度事实。`coverageStats()` 去重统计全库 `librarySchoolCount/libraryProgramCount`，与本次调查数量独立。

报告按规划方向、意向城市映射的种子学校和 `searchSchools` 先召回原文和事实，保留来源ID与原获取时间，计入 `reusedSourceCount`。命中已绑定目录后使用既有 `research-repair.ts` 按缺口补查，`research-library-first.ts` 只为同项目仍缺的字段保留搜索；新读原文和确定性绑定结果随即入库。复用仍须经过当前画像的推荐校验，不能复用其他人的推荐结论。初期18次搜索、全程24次搜索及24次正文读取预算保持不变。

原文表允许 `.edu.cn` HTTP并保存 `transport/finalUrl/redirectChain`；复用保留明文传输标注。以最终地址为同页键，HTTP/HTTPS 去重，别名映射用于跳过未过期页面。种子登记的非edu学校HTTPS原文可入库，非edu明文不接收；报告reader权限不扩大，公网DNS、固定IP、同校最多3跳的限制保持不变。

`robots.ts` 与 `scripts/prefetch-schools.mjs` 实现 D-14：默认每校20页、深度≤3、每主机串行、间隔≥1秒、全局主机并发≤4；robots.txt 不允许时不抓取；4xx 视为无限制（429 除外）；429/5xx/网络失败时跳过该主机。robots 获取复用阶段1安全 reader，同校注册域名内最多3次跳转、每跳公网 DNS 校验、固定连接 IP、跨站拒绝；2xx（含空响应）逐行解析，无效行忽略，HTML 无有效规则即无限制。保留最具体 UA 组、最长匹配、同长 Allow 优先与 `*`/`$`；前100000字节流式解压后截断解析，普通网页仍拒绝超限。robots 结果按主机缓存，页面逐跳检查。PDF/XLS/XLSX继续复用现有附件解析器。支持 `--dns-mode system|public-doh`，默认沿用服务端 YANTU_DNS_MODE；不打印配置，不调用付费搜索或模型。`--dry-run` 不建库、不联网，`--refresh` 强制复核；汇总打印字段 bound/pending、失败码与 robotsSkipped，并分别记录 robotsDisallowed（规则明确禁止）、robotsUnavailable（获取失败）及 robotsUnavailableByCode（429/5xx/超时/DNS/连接等安全原因码）。杭师大本次免费重跑与页面列表见实施说明13.7。

研招网实际专业目录是脚本模板，阶段4采用安全降级：`chsi-probe.ts` 仅以公开GET探测 robots 与 `/zsml/`、`/sch/`，不提交表单、不登录、不绕过验证。平台页仍不当学校官网域名，不能授权跨站跳转或产生专业事实；部署方可收集学校公开原文，再由资料库确定性入库，人工审核另走正式目录流程。免费实测结论见实施说明13.5。

阶段4审查修正采用 `phase2-program-binding@2`，阶段7人工审计后升级为 `phase2-program-binding@3`：科目范围在下一条字母或数字专业代码处结束，识别括号学位标签，城市降级不采用联系前缀或纯研究生院/招生办地址。旧规则事实在打开资料库时从原文确定性重提取，保持原获取时间。`programEntries` 为事实与推荐共用：仅招生专业目录／招生目录页面或含多行代码与名称的表格产生身份；名称至少2个汉字，拒绝等、待定、其他、专业、方向、详见、另行通知等停用词，代码与名称同一目录行相邻。国家目录中该代码的名称或明确别名优先归一到官方名称，引用仍为原文。catalog quote限本行或连续相邻行、≤300字。

初试 bound/pending 都须包含具体科目代码加科目名，或思想政治理论、英语一／二、数学一／二／三、管理类综合能力、经济类综合能力等明确统考名称。“详见目录／准考证”指引句不收；同一专业身份、年度的初试原文规范化去重。学费冒号条目标题与紧随金额行连续理解；新增 tuition.scope=`school_degree_type`，只按同校、学术／专业学位、全日制／非全日制匹配唯一金额及计费单位，不升级成专业专属价格。目录可补足学习方式；方式未知时分别展示档次、不选档、预算待核验。指定专业／学院表格金额及中外合作单独标准不能借用。

学院培养规则按明确学院列表和“其他学院”排除范围适用，未知学院不套用。校区名称含城市或种子 campusHints 映射的全部备选校区同城，才核验培养城市；下沙或文一仍不选具体校区，下沙或绍兴保持待确认并只展示适用学院原文。学校级 registrySchoolCity 在同校已读正文出现跨城命名校区时停止推断，包含绍兴校区及海宁国际校区，不能只查已登记提示。

预抓取使用按得分排序的优先队列，目标年度、专业目录／招生目录及其 PDF/XLS 附件优先，简章／章程、学费、硕士次之；博士、港澳台、留学生／国际学生、本科、同等学力加试、早于当前年度两年以上及重复导航栏目降权。文章标题优先使用真实发现链接文字，避免全站固定title掩盖文章含义；HTML表格保留同一行各单元格，附件仍由既有解析器读取。默认每校20页、深度≤3，礼貌间隔和DNS／robots限制不变。免费重跑与10条事实抽样见 [阶段4质量冒烟记录](../../docs/阶段4事实质量冒烟.md)。

## 阶段5统一预算与诊断

阶段5预算统一定义于 `server/explanation/research-budget.ts` 的 `RESEARCH_BUDGET`，文档测试直接读取该模块校验数字。

- 每份报告最多24次搜索，初期最多18次搜索，费用补查最多6次搜索；资料库命中与种子直读不消耗付费搜索。定向补查只使用剩余搜索额度。
- 正文累计最多60次正文读取，每校累计最多8次读取；初期最多40次读取，意向城市最多追加8次读取，地理与费用/校区阶段使用剩余额度。资料库优先流程也使用同一预算。
- 全局读取并发≤4，同主机串行；发送前原子预留总量、单校与平台上限，失败计入且不重试。按派发顺序合并正文与附件，取消时停止派发并通过 AbortSignal 中止在途连接。研究读取无需额外主机间隔，后台预抓取仍保持间隔≥1秒。
- 保留最多80条搜索候选、最多24条同校PDF附件候选；每页最多12条附件链接、深度≤3；种子导航最多6次、研招网平台最多4次读取，均共享总预算，平台动态页面安全降级规则不变。
- 最终输入优先使用阶段4 `library.queryFacts` 与本次新页面的绑定结果；按学校、学院、专业代码/名称、学位、学习方式及字段去重，bound/pending 均保留 status、年度、sourceId、值与短原文。pending 必须显示“待确认”。学校级学费 school_wide / school_wide_mode / school_degree_type 及仅城市级核验保留适用范围，不能扩大为专业级收费或具体校区事实。
- 同一身份同一字段已有目标年度或最新年度 bound 时，不再输入较旧或同年的 pending；其余 pending 每身份每字段最多2条，优先目标年度，再按年份新旧。只裁剪输入，不删除公共资料库事实。
- 正文来源按相关性与学校覆盖排序，同一URL不重复放入来源列表。最终 JSON 输入最多40000字符，最多40项正文来源；超限先缩短正文，再移除低优先级正文，最后裁剪结构化事实，保留完整 JSON。预留2000字符供修复指令。非思考仍为16000字符，规划输入不变；请求体最多131072字节，足以容纳合法上限中文及协议字段。模型引用仍须属于实际可见输入的来源，不可补造未知字段。
- 报告 `usage` 记录付费搜索/搜索缓存/资料库命中、读取成功/失败及按校计数、模型调用数和响应实际输入/输出 token（包括被校验拒绝的响应）。模型缓存命中不算新调用；未知响应保留预留。诊断随画像受账号权限保护，不写入公共资料库。

额度按输入 JSON 字符数加最大输出预留：规划每次 16000 + 4096 = 20096，最终每次 40000 + 16384 = 56384。规划与最终各一次修复，加一次整份报告共享的临时故障重试，最坏 2 × 20096 + 3 × 56384 = 209344；可选覆盖补充再加 56384，完整上界 265728。整份报告最多6次模型请求，规划与初次报告每阶段最多3次，但二者共享一次临时故障重试。默认每账号每日300000、全站900000模型 token，应用和直接创建运行时一致。研究、咨询和解释使用同一额度；这是本地账本，不是供应商账户余额或充值。

整份报告默认30分钟总超时，最终模型流式思考默认45秒空闲超时与300秒总上限；最终请求还会取整份报告剩余时间的较小值。非思考规划保持30秒，单页下载8秒，PDF/XLS解析另有5秒上限。超时保留MODEL_TIMEOUT或RESEARCH_TOTAL_TIMEOUT失败原因、可用建议和断点，允许用户手动续跑；不自动重试超时，未知用量仍保留预留额度。所有超时常量集中在research-budget.ts，取消检查贯穿所有阶段。
