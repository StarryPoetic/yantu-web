# 服务端题库扩建

`example-v1.json` 是既有 20 道演示题的服务端迁移，**未经真实学科审校**。它始终保留 `draft/unpublished`，只能由服务端显式允许本地示例练习；不能发布为正式题库，也不能作为推荐依据。前端只读取测评题目 allowlist，不能导入此目录或服务器模块。

扩建时复制 `question-template.json` 填写题干、唯一正确选项、解析、知识点、适用范围、人工初分难度、干扰项假设和来源版权。题库 `knowledgePoints` 是该范围的知识点目录，未覆盖项保持待评估。`math-one/math-two/math-three` 是范围，`basic/intermediate/advanced` 是难度；不能混用。源数据、审核记录、题库版本与推荐目录版本分开维护。

单题经学科人员检查答案唯一性、条件完整、选项差异、解析一致、范围适用及版权后，写入 `review` 并将审核状态置为 `approved`。记录的六个 check 名称见模板。审核人员和审校时间必须是真实记录，结构校验不能替代人工学科审核；不要为了运行示例伪造记录。

将审校后的修订放入一个 `mode: reviewed` 的候选集合，用 `validateQuestionBank(bank, true)` 验证，然后通过 `publishQuestionBank(bank, newVersion)` 生成新的发布快照。不可原地改写已发布题干或答案。发布、撤回、切换活动版本由应用的管理员事务负责；本模块不直接写文件或切换指针。不得使用模型临时补题。

组卷固定每科五题并保存实际题目修订与顺序，要求唯一题目、范围和知识点覆盖。基础自评只决定难度优先配比，实际题池缺少档位会显示明确说明，不标称校准有效；题数或覆盖不足返回 `422 INSUFFICIENT_QUESTION_COVERAGE`。专业课只允许 `confirmedMajorId` 显式确认的专业。现有示例计算机 ID 为 `research/practice`，正式目录应复核专业映射。

答案更正发布新修订；进行中尝试用 `closeAttempt(..., 'invalidated', reason)` 失效，已提交尝试通过 `correctDiagnosis` 新建诊断并保留原题目和原评分。旧诊断退出后续推荐，所有历史快照仍可追溯。扩建验证可运行 `node --experimental-strip-types --test tests/backend/assessment.test.ts`。
