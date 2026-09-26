# 全国研究生学科专业目录与专业探索规则

这里维护全国**分类目录**及专业探索词表。学校、学院、具体专业方向、年度招生项目、考试科目和资格条件仍在 `knowledge/catalog/`，两套资料不可互相替代。增加学校招生资料不应改动全国目录；增加全国目录也不代表已覆盖这些专业的学校招生信息。

## 当前覆盖与来源

`catalog.json` 的版本为 `moe-graduate-2022-checked-20260927-v1`，核对日期为 2026-09-27，基础版本是教育部与国务院学位委员会发布的《研究生教育学科专业目录（2022年）》，自 **2023 年**起实施。完整提取 **14 个门类、117 个一级学科、67 个专业学位类别，共 184 条四位代码**。

| 来源 | 用途与范围 |
| --- | --- |
| [国务院学位委员会、教育部通知](https://www.moe.gov.cn/srcsite/A22/moe_833/202209/t20220914_660828.html)及[目录原附件](https://www.moe.gov.cn/srcsite/A22/moe_833/202209/W020220914572994461110.pdf) | 代码、名称、门类、学术/专业类别、授位附注的事实来源 |
| [教育部 2025 年有关学科专业调整对应关系表](https://www.moe.gov.cn/srcsite/A22/s7065/202506/t20250611_1193766.html) | 核对国际中文教育、博物馆、风景园林、建筑、城乡规划的旧名称对应；表中专业领域不计为新增一级学科 |
| [教育部 2026 年度公务员考录职位说明](https://www.moe.gov.cn/s78/A04/tongzhi/202510/t20251015_1416829.html) | 其研究生分类仍指向 2022 年目录，作为版本交叉核对；该页面的职位资格不进入考研资格规则 |
| [新版目录及管理办法答记者问](https://www.moe.gov.cn/jyb_xwfb/s271/202209/t20220914_660966.html) | 解释基础目录与动态调整机制，避免把固定快照宣传为实时全覆盖 |

本次教育部附件直连发生连接异常，归档的 PDF 来自[长安大学官方网站保存的同版原件](https://webplus.chd.edu.cn/_upload/article/files/00/2f/f9d3977646529ced5e6242ba6e34/f637f2ae-61df-4de4-a12f-6c1f855861a9.pdf)。`sources/moe-graduate-catalog-2022.pdf` 保留原文件；JSON 同时记录教育部原始 URL、实际提取 URL、SHA-256、发布时间与核对日期。2025 对应表另经[天津大学官方转载](https://gs.tju.edu.cn/info/1181/14242.htm)核对。文件哈希证明所用归档一致，不能代替对发布机关的核验。

截至本次核对，使用上述基础目录与已核对的 2025 对应表；未把网上所谓“2025/2026 新版”的非官方汇总当作新目录。**不承诺实时涵盖此后未接入的调整，也不涵盖所有学校二级学科、自设学科、交叉研究方向和六位年度招生专业，更不是全国招生项目全集。** 2026 年普通本科专业目录是另一套分类，不能导入本文件当作新增研究生类别。

## 提取与复核

`extract_catalog.py` 只读取本地归档 PDF，使用 Python 的 `pypdf` 提取，不发网络请求、不覆盖原件。安装或选择已有 `pypdf` 环境后运行：

```text
python knowledge/disciplines/extract_catalog.py
node --test tests/backend/discipline.test.ts tests/backend/discipline-api.test.ts
```

目录本体实际单列 181 行。医学的 **1051 临床医学、1052 口腔医学、1055 药学** 明确写在 1002、1003、1007 的附注中，提取脚本按原文展开为独立专业学位类别，所以最终为 184 条而非遗漏后的 181 条。每条保留 PDF 的物理页码 `sourcePage`（含封面与说明页）。代码为字符串，不能转数值丢失前导零。

`mastersOnly` 对应专业类别名称后的星号：带星号仅可授硕士，其他专业类别可授硕士和博士；这不证明每所学校都有相应授权。一级学科授位门类附注原样保留到 `notes`，不可从门类代码擅自推断考试科目或院校授权。

修改来源时先归档新原件、记录原始与提取地址、核对附件的出版年份和发布机关。更新提取逻辑、目录版本及覆盖统计，逐页比对新增/删除/更名/附注，复核医学脚注类别、唯一代码与学位类型。通过相关测试后与代码一起提交 Git。旧结论内含完整分类与来源快照，保留其旧版本；目录或规则版本变化使 `needsRefresh` 为真，不追写历史内容。

## 可维护的知识位置

- `catalog.json`：官方分类事实，不加入就业、难度、院校排名、报考资格猜测。
- `signals.json`：明确标注为**产品探索词表**，用于将用户的意向、本科专业、课程和目标中的字面词语连接到目录方向。这不是官方本科—研究生专业等同表。每条 code 必须已存在于官方分类目录，修改时提升 `ruleVersion` 并增加有意义的用例。
- `server/disciplines/index.ts`：目录检索与纯函数 `generateGuidance`。固定输入、固定时间和版本得到固定结果；完整 184 项始终保留。没有证据时不自动填入计算机，也不生成适合度分数、排名或录取概率。
- `shared/discipline-matching.ts`：前后端共用的年度项目匹配。官方四位 code 必须和项目真实 `identity.majorCode` 前四位及 `degreeType` 一致；旧 `research/practice` 仅兼容原项目明确的 `majorDirectionIds`，不能扩展成整个学位类型。
- `server/routes/guidance.ts`：读取会话拥有的已保存画像与已提交测评、校验版本、保存快照并计算历史刷新状态。用户不能提交结论、排名、考分或其他人的诊断内容。
- `server/explanation/`：可选模型解释的位置。模型只解释已确定的快照，不能改专业代码、目录事实、候选顺序、资格、排名或能力统计。

公共课观察只包含实际作答数量和已覆盖知识点；不用少量政治、英语、数学题淘汰任何专业，也不推断某个专业必考哪种数学。示例或不具正式可用性的测评进入 `ignored` 并说明原因，可以展示本次练习观察，但不计入 `assessmentSummary.used` 正式依据数。已撤回题库的诊断仅保留忽略原因，连观察也不进入新结论，仍可根据画像完成探索；已有引用快照标记需要刷新。仅“愿意/不愿意跨专业”不足以判定某方向的招生资格；“只接受相近专业”必须保留为待核对的条件。

## HTTP 合同

| 操作 | 输入与结果 |
| --- | --- |
| `GET /api/v1/disciplines` | 公开访问。可选 `q/groupCode/degreeType`；返回 `DisciplineCatalog` 与 `matched`。`coverage` 始终表示完整基础目录，`items` 是本次筛选结果。 |
| `PUT /api/v1/me/profile` | 首次确认保存（即使全为空白）产生 `profileVersion: 1`、`profileCompleted: true`、`profileSavedAt`；同内容重存不增版本。历史正版本画像兼容为已保存，未知旧保存时间保留 `null`。 |
| `POST /api/v1/guidance` | 仅接受 `{profileVersion, selectionVersion, assessmentRefs: [{assessmentAttemptId, diagnosisVersion}]}`；需要保存过画像，未知项可留空。返回固定 `GuidanceRun` 和动态 `needsRefresh/refreshReasons`。 |
| `GET /api/v1/guidance/latest` | 当前会话最新快照，返回 `{guidance: null}` 或 `{guidance: GuidanceRun & freshness}`。 |
| `GET /api/v1/guidance/:id` | 读取本人的历史快照；画像、确认专业/屏蔽、目录、解释规则、引用诊断或题库变化会标记 `needsRefresh`。 |

类型定义在 `server/disciplines/types.ts`。`highlightedIds` 是可优先探索的子集；`directions` 包含整个基础目录，按代码保留稳定顺序，`rank/fitScore` 始终为 `null`、`eligible` 为 `unknown`。页面可先展示线索方向，完整目录另提供检索与门类筛选。
