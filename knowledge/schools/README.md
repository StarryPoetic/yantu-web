# 全国院校发现种子库

[registry.json](registry.json) 收录458所招生高校，覆盖31个省级行政区，含全部147所第二轮双一流高校。来源为阶段3提供的455所草稿，加上经免费官网读取确认的浙江外国语学院、杭州医学院和榆林大学。它是网址发现目录，不是完整硕士招生单位清单。

查询返回 `discoveryOnly: true`，核验通过仅表示网址可读且能找到学校名称或别名，不证明招生专业、学费、校区或科目。正式招生事实仍须来自本次实际读取并通过身份、硕士语境、年度和专业归属核验的官网正文。与 [knowledge/catalog](../catalog/README.md) 人工审核发布的年度项目目录保持独立；不会自动发布网络资料，研究来源始终 `verified:false`。

## 字段与查询

| 字段 | 含义 |
| --- | --- |
| name / aliases | 招生单位正式名称及可核验简称、旧名。榆林大学的旧名榆林学院列为别名，不能成为下属学院。 |
| province / city | 31省级行政区中的省份、主校区城市；按 shared/cities.ts 规范化，必须可识别且省市一致。 |
| registrableDomain / homepage | 唯一学校注册域名及官网首页；复用阶段1 registrableDomain 算法。 |
| graduateAdmissionsUrl | 已确认的研招或研究生招生入口；不确定时为 null。 |
| campusHints | 校区名称、城市、可选 provenanceUrl。只是跨城调查提示，不证明某专业在该校区培养；缺少提示也不代表已完成全校校区普查。 |
| tags | 双一流等发现排序标签，不参与推荐质量或录取判断。 |
| discoveryUrls / locationDiscoveryUrls / provenanceUrl | 更具体的招生导航、校区地理导航和线索出处；保留原杭州5校的全部网址。 |
| verification | checkedAt、homepageOk、graduateAdmissionsOk、可选 failureCode。true为通过、false为失败、null为未核验或网址缺失；urls 可保存逐网址布尔结果。 |

[server/schools/index.ts](../../server/schools/index.ts) 在启动时加载并校验结构、重复名称／别名／注册域名、省市、URL归属和核验摘要；错误会明确报错并阻止启动。查询支持名称／别名、主机／注册域名和城市。城市查询标明 `cityMatch: main` 或 `campus_hint`，所有学校线索均冻结且标为 `discoveryOnly: true`。

发现网址依 `discoveryUrls → graduateAdmissionsUrl → homepage` 去重排列，排除明确失败的网址。一个入口失败不会禁用该校其他通过或未核验的入口。

每个意向城市最多12条线索（`MAX_CITY_CANDIDATE_LEADS`），双一流优先、随后按校名稳定排序。主校区和跨城校区提示都参与发现。城市招生单位清单检索继续覆盖所有城市。学校级查询使用具体学校注册域名 `includeDomains`；无法匹配的学校保留原有网页归属回退。

种子直接导航最多6次（`MAX_REGISTRY_NAVIGATION_READS`），搜索已观察到的来源优先，导航不占用意向城市恢复预留槽位；导航、专业页、附件仍共享180次总读取及每校30次上限。初期最多54次搜索、120次读取，城市恢复最多追加24次读取；全程最多120次搜索。这里的发现线索数量与最终4–5所报告卡片不是同一指标。

<!-- current-research-budget:start -->

| 代码配置项 | 当前值 |
| --- | ---: |
| `cityCandidates` | 12 |
| `registryReads` | 6 |
| `initialSearches` | 54 |
| `initialReads` | 120 |
| `cityReads` | 24 |
| `schoolReads` | 30 |
| `reads` | 180 |
| `searches` | 120 |

<!-- current-research-budget:end -->

## 新增、修改与维护责任（D-13）

资料负责人依据学校官网的正式名称、硕士招生证明和官网首页链接新增条目；部署方负责执行安全核验脚本和发布前校验。收录独立招生高校，暂不扩展到未独立招生的下属学院，也不声称覆盖所有科研院所。

1. 查询正式名称、别名和注册域名，先排除重复；更名时更新 name 并将可证实旧名加入 aliases。
2. 由官方页面确认主城市和跨城校区；校区提示附官网出处。研招入口无法确认就保持 null，保留固定失败码，不编造路径。
3. 运行对应省／市核验，检查失败与同校跳转；修改相关回归测试，通过 npm run check 后创建 Git commit。

每月及发布前由部署方执行受影响条目的免费复核，资料负责人复查学校更名、迁址和招生入口变化。失败网址不能自动改写为猜测地址，重试成功后才能恢复通过状态。任务书未要求全国重探，本轮保留全国草稿核验摘要并只对浙江重新运行脚本。

## 免费核验

```powershell
node scripts/verify-school-registry.mjs --province 浙江
node scripts/verify-school-registry.mjs --city 杭州 --limit 5
node scripts/verify-school-registry.mjs --province 浙江 --write
```

默认只输出逐校摘要与汇总；`--write` 仅更新所选条目的 verification。脚本不加载或修改 .env，不调用模型或付费搜索。使用现有安全 reader，全局并发≤6、同一学校注册域名串行、相邻请求间隔至少1秒、单次超时10秒。每跳校验公网DNS并固定连接IP，最多3次同校跳转，允许教育网HTTP并记录实际 transport、encoding、finalUrl；保留TLS、大小与地址限制。

遵守现有 `YANTU_DNS_MODE` 设置。需要 public-doh 时仅显式设置该非秘密进程配置；不会自动绕过 system 模式的拒绝结果。

2026-10-11使用 public-doh 对浙江25校实际免费核验：首页22/25（88%），非空研招20/21（95.24%），所有招生／地理导航页48/54（88.89%）。杭州医学院在另一免费网页读取渠道能读到官方硕士招生与入口，但项目 reader 当次DNS失败，摘要仍记为失败；中国计量大学当次首页失败，研招入口保持 null；中国美术学院的首页通过但未确认可读的普通硕士研招入口，保持 null。

浙江外国语学院的硕士招生依据为 [2026招生简章](https://jyxy.zisu.edu.cn/info/1074/7296.htm)，杭州医学院依据为 [学校官网](https://www.hmc.edu.cn/) 和其研究生院链接。榆林大学正式名称、旧名及硕士招生依据见 [学校简介](https://www.yulinu.edu.cn/xygk/xxjj.htm)。西湖大学当次官方招生入口仅见博士，未加入。浙江大学海宁国际校区（嘉兴）、舟山校区，以及抽查发现的杭州电子科技大学绍兴校区等已加入 campusHints。

核验通过率是当次网络可读性与名称匹配率，不能当成专业事实覆盖率；原始输出保存在 Git 忽略的 var 目录。

## 历史发现预算（非现行）

以下是阶段3实施时的预算记录；当前上限以本页现行表和 `research-budget.ts` 为准。

种子直接导航最多6次（`MAX_REGISTRY_NAVIGATION_READS`），搜索已观察到的来源优先。导航不占用初期16次读取之后的意向城市恢复槽位；专业页及附件仍共享初期每校4次、后续每校6次与24次总读取预算。初期18次搜索、全程24次搜索不变，城市查询保留后续学校与费用调查空间。
