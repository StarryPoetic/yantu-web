# 服务端题库扩建

题库内容和正确答案放在本目录，组卷、评分、公开字段与图示校验放在 `server/assessment/`。前端只读取服务端公开的测评字段，不能导入题库文件或服务器运行时代码。全国学科目录在 `knowledge/disciplines/`，招生项目资料在 `knowledge/catalog/`，分别维护和发布。

`example-v1.json` 保留原有 20 道演示题，当前内部版本为 `example-unreviewed-v2-presentation`，补充了行列式结构图与公式。它**未经真实学科审校**，保持 `draft/unpublished`，仅供服务端显式启用的本地示例练习，不用于正式诊断或推荐。升级当前示例库时保留已创建测评的原题目快照。

## 内容、范围与审核

扩建时参考 `question-template.json`，填写唯一正确选项、解析、知识点、适用范围、人工初分难度、干扰项假设以及来源和使用权。`knowledgePoints` 是题库范围的知识点目录，未覆盖项保持待评估。`math-one/math-two/math-three` 是范围，`basic/intermediate/advanced` 是难度，不能混用。

每题可增加以下教学字段：

| 字段                   | 使用时机             | 内容要求                                                                                                     |
| ---------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------ |
| `studyHint`            | 作答中的逐题提示     | 只提示知识点、定义和方法，不含正确选项、本题代入结果或变相答案；最长 1500 字符。未填写时使用通用知识点提示。 |
| `presentation`         | 题干公开展示         | 适合答前展示的公式与结构图，不夹带解答。                                                                     |
| `solutionPresentation` | 主动交卷后的逐题解析 | 解题推导与公式图示，不能进入未交卷的公开题目对象。                                                           |

正式题库的题干、提示、解析、图示及无障碍说明应一起审核。学科人员必须确认答案唯一、条件完整、选项差异、解析一致、范围适用和版权，六个 check 名称见模板。管理接口要求独立审核者显式勾选检查项，发布不会代填审核记录。结构校验不能代替学科审核，也不能为示例题伪造身份或审核时间。

经真实审核的修订组成 `mode: reviewed` 候选题库，经过 `validateQuestionBank(bank, true)` 校验，再由管理员审核发布流程调用 `publishQuestionBank(bank, newVersion)` 生成快照。发布、撤回与活动版本指针由应用事务维护，不能原地改写已发布的题目、答案或版本，也不能用模型临时补题。

## 专业公式与结构图

字段类型在 `server/assessment/types.ts`，白名单校验在 `server/assessment/presentation.ts`，渲染在 `src/workspace/TutorContent.tsx`。题库公式使用结构化表达式，前端生成原生 MathML；支持文本、组合行、分数、幂、矩阵和行列式。例如：

```json
{
  "formulas": [
    {
      "label": "题干中的二阶行列式",
      "expression": {
        "kind": "determinant",
        "cells": [
          ["2", "0"],
          ["0", "3"]
        ]
      }
    }
  ],
  "diagram": {
    "kind": "matrix",
    "cells": [
      ["a", "b"],
      ["c", "d"]
    ],
    "highlightDiagonal": true,
    "alt": "二阶矩阵位置示意，主对角线为 a、d。"
  }
}
```

`matrix` 图示由固定组件生成 SVG，不接收任意 SVG 源码。也支持 `{kind:"image",src:"/question-media/geometry-1.png",alt:"图示说明"}`，资源放在 `public/question-media/`；只允许该路径下名称由字母、数字、下划线、连字符构成的 PNG、WebP、JPG，拒绝远程图片、路径穿越、脚本和 SVG 文件。`alt` 必填。

公开静态图片不具备交卷权限保护，只用于题干或通用知识图；不要在其中存放需要答前保密的解答。当前解题结果优先用 `solutionPresentation` 的结构化公式，通过交卷后的接口返回。若将来需要保密解答图片，应先增加鉴权媒体接口和对应测试，不能直接使用公开资源路径。

每份展示数据最多 8 个公式、矩阵最多 8×8、表达式嵌套最多 6 层，另有文本和整体大小限制。新增图示类型时同步扩展类型、校验器、固定渲染组件和测试，不能透传任意 HTML/SVG。咨询与逐题模型回答中的 LaTeX 由受限 KaTeX 渲染，不替代题库结构或固定解析。

## 组卷、逐题讲解与版本

组卷固定每科五题，保存实际修订与顺序，要求题目唯一、范围适用和知识点覆盖。基础自评只决定难度优先配比；档位不足会说明原因，题数或覆盖不足返回 `422 INSUFFICIENT_QUESTION_COVERAGE`，不伪装成有效校准。专业课依据用户显式确认的 `confirmedMajorId` 匹配 `majorIds`；本科专业或模型推测不等于确认。示例的 `research/practice` 是历史映射，新增正式题库应对应已确认的全国学科或业务专业标识。

`POST /api/v1/assessment-attempts/:id/tutor` 在作答中只返回该题方法提示，不调用模型解题、不返回答案或解答图示。交卷后，每题可查看固定解析并持续追问；服务端仅发送已交卷的本题固定依据，可选的个人解题思路默认不发送。模型不可用时返回本题原解析，不影响评分。模型讲解是教学参考，不保证每句话正确，也不能改写评分或公开未提交题目的答案字段。示例解析仍是未经审校的示例，不因经过模型讲解而变为正式依据。

答案更正应发布新修订。进行中的测评通过 `closeAttempt(..., 'invalidated', reason)` 失效，已提交测评通过 `correctDiagnosis` 创建新诊断并保留原题目和原评分，历史快照保持可追溯。撤回题库后停止生成和重放相应辅助讲解。

相关验证：

```sh
node --test tests/backend/assessment.test.ts tests/backend/question-publication.test.ts tests/backend/tutor-chat.test.ts
npx playwright test tests/tutor-chat.spec.ts
```
