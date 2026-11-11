# 现存示例题库审校覆盖清单

本文件由 `node scripts/question-review-pack.ts --write` 离线生成。当前版本 `example-unreviewed-v4-v3b-diagnostic`，共56题；学科人工审核0、校准0。只描述仓库题目和标签，不是官方考试大纲覆盖率。

每科五题不足以换算考研成绩、确定能力等级或录取概率。难度仍为人工初分；英语翻译/写作题为选择题片段，未实际测量完整翻译或写作产出；专业题为计算机/研究方法示例，不能代表机械等所有专业考试。

## 模块与范围

| 模块 | 题数 | 基础/中等/提高 | 已有知识点数 | 声明中无题的知识点 |
| --- | ---: | --- | ---: | --- |
| math | 23 | 10/7/6 | 23 | 其他未覆盖知识点（待评估） |
| english | 17 | 9/4/4 | 17 | 其他未覆盖知识点（待评估） |
| politics | 8 | 6/1/1 | 8 | 其他未覆盖知识点（待评估） |
| major | 8 | 6/1/1 | 8 | 其他未覆盖知识点（待评估） |

上表“其他未覆盖知识点（待评估）”是旧库保留的缺项说明，不是已覆盖的具体知识点。正式大纲逐点映射及未列出的内容仍等学科人员确认。

| 范围标签 | 题数 | 基础/中等/提高 |
| --- | ---: | --- |
| common-foundation | 56 | 31/13/12 |
| computer-foundation | 5 | 5/0/0 |
| english-one | 16 | 9/3/4 |
| english-two | 13 | 9/4/0 |
| math-one | 19 | 9/5/5 |
| math-three | 19 | 9/6/4 |
| math-two | 11 | 6/3/2 |
| politics | 5 | 5/0/0 |

标签会重叠，不能把范围数量相加。专业标识 `practice / research` 为历史示例值，尚未映射为已确认的国家学科/真实目标专业。

## 明确缺项

- 19题没有独立提示正文（运行时可使用通用提示），需逐题审查是否应补提示；现有提示也要检查是否泄露答案。
- 56题未记录干扰项错误假设；不能因此自动解释学生真实错因，仍需学科复核。
- 范围标签下的难度空档：computer-foundation缺intermediate/advanced；english-two缺advanced；politics缺intermediate/advanced。这表示当前标签题池空档，是否补题及适用范围需学科确认，不能自动改标签凑数。
- 全部题目缺真实独立学科审核、来源/使用权确认和试测校准；结构检查不能替代这些工作。
- 校准的人群、采样/同意程序、样本量、难度/区分度方法、信度效度、分数映射与验收阈值均为null，尚无人批准。不按题数自动设置校准通过线。
- 审校包包含正确答案，只存服务端知识目录，不复制到public或前端资源。

逐题完整题干、选项、答案、解析、公式/图示、提示、来源和人工空白检查表见 `question-review-pack.json`。原题快照和每题哈希用于发现题目更新；不得在模板中填完结果后运行生成器覆盖。

## 逐题审校索引

| 题号 | 模块 | 知识点 | 初分难度 | 范围标签 | 状态 |
| --- | --- | --- | --- | --- | --- |
| v2-m1 | math | 导数的基本运算 | basic | common-foundation、math-one、math-three、math-two | 待独立审校 |
| v2-m2 | math | 定积分与基本定理 | basic | common-foundation、math-one、math-three、math-two | 待独立审校 |
| v2-m3 | math | 函数极限 | basic | common-foundation、math-one、math-three、math-two | 待独立审校 |
| v2-m4 | math | 线性代数：行列式 | basic | common-foundation、math-one、math-three、math-two | 待独立审校 |
| v2-m5 | math | 概率：独立事件 | basic | common-foundation、math-one、math-three | 待独立审校 |
| v2-e1 | english | 阅读：让步关系 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v2-e2 | english | 词汇：语境理解 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v2-e3 | english | 语法：主谓一致 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v2-e4 | english | 阅读：因果关系 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v2-e5 | english | 词汇：指代与近义 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v2-p1 | politics | 哲学：实践与认识 | basic | common-foundation、politics | 待独立审校 |
| v2-p2 | politics | 哲学：量变与质变 | basic | common-foundation、politics | 待独立审校 |
| v2-p3 | politics | 哲学：矛盾特殊性 | basic | common-foundation、politics | 待独立审校 |
| v2-p4 | politics | 哲学：联系的条件性 | basic | common-foundation、politics | 待独立审校 |
| v2-p5 | politics | 哲学：认识的发展 | basic | common-foundation、politics | 待独立审校 |
| v2-c1 | major | 数据结构：栈 | basic | common-foundation、computer-foundation | 待独立审校 |
| v2-c2 | major | 算法：二分查找 | basic | common-foundation、computer-foundation | 待独立审校 |
| v2-c3 | major | 数据结构：队列 | basic | common-foundation、computer-foundation | 待独立审校 |
| v2-c4 | major | 计算机基础：二进制 | basic | common-foundation、computer-foundation | 待独立审校 |
| v2-c5 | major | 算法：顺序遍历 | basic | common-foundation、computer-foundation | 待独立审校 |
| v3b-math-01 | math | 高数：复合函数求导 | basic | common-foundation、math-one、math-two、math-three | 待独立审校 |
| v3b-math-02 | math | 高数：积分换元 | intermediate | common-foundation、math-one、math-two、math-three | 待独立审校 |
| v3b-math-03 | math | 高数：二元函数偏导 | intermediate | common-foundation、math-one、math-two、math-three | 待独立审校 |
| v3b-math-04 | math | 高数：微分方程初值 | advanced | common-foundation、math-one、math-two、math-three | 待独立审校 |
| v3b-math-05 | math | 线性代数：向量线性相关 | basic | common-foundation、math-one、math-two、math-three | 待独立审校 |
| v3b-math-06 | math | 线性代数：齐次方程自由变量 | intermediate | common-foundation、math-one、math-two、math-three | 待独立审校 |
| v3b-math-07 | math | 线性代数：二次型正定 | advanced | common-foundation、math-one、math-two、math-three | 待独立审校 |
| v3b-math-08 | math | 概率统计：条件概率 | basic | common-foundation、math-one、math-three | 待独立审校 |
| v3b-math-09 | math | 概率统计：独立变量方差 | intermediate | common-foundation、math-one、math-three | 待独立审校 |
| v3b-math-10 | math | 概率统计：样本均值方差 | advanced | common-foundation、math-one、math-three | 待独立审校 |
| v3b-math-11 | math | 数一拓展：空间直线方向 | basic | common-foundation、math-one | 待独立审校 |
| v3b-math-12 | math | 数一拓展：三重积分 | intermediate | common-foundation、math-one | 待独立审校 |
| v3b-math-13 | math | 数一拓展：曲线积分 | advanced | common-foundation、math-one | 待独立审校 |
| v3b-math-14 | math | 数一拓展：第二型曲面积分 | advanced | common-foundation、math-one | 待独立审校 |
| v3b-math-15 | math | 经济应用：边际成本 | basic | common-foundation、math-three | 待独立审校 |
| v3b-math-16 | math | 经济应用：利润最大化 | intermediate | common-foundation、math-three | 待独立审校 |
| v3b-math-17 | math | 经济应用：需求价格弹性 | intermediate | common-foundation、math-three | 待独立审校 |
| v3b-math-18 | math | 经济应用：连续收入现值 | advanced | common-foundation、math-three | 待独立审校 |
| v3b-english-01 | english | 英语阅读：事实定位 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v3b-english-02 | english | 英语阅读：限定性推断 | intermediate | common-foundation、english-one、english-two | 待独立审校 |
| v3b-english-03 | english | 英语阅读：让步与论证边界 | advanced | common-foundation、english-one | 待独立审校 |
| v3b-english-04 | english | 英语长难句：主干识别 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v3b-english-05 | english | 英语长难句：否定转折 | intermediate | common-foundation、english-one、english-two | 待独立审校 |
| v3b-english-06 | english | 英语长难句：嵌套条件与否定 | advanced | common-foundation、english-one | 待独立审校 |
| v3b-english-07 | english | 英语翻译：比较结构 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v3b-english-08 | english | 英语翻译：范围与限定 | intermediate | common-foundation、english-one、english-two | 待独立审校 |
| v3b-english-09 | english | 英语翻译：让步从句 | advanced | common-foundation、english-one | 待独立审校 |
| v3b-english-10 | english | 英语写作：应用文请求 | basic | common-foundation、english-one、english-two | 待独立审校 |
| v3b-english-11 | english | 英语写作：图表描述与证据 | intermediate | common-foundation、english-two | 待独立审校 |
| v3b-english-12 | english | 英语写作：议论文论证 | advanced | common-foundation、english-one | 待独立审校 |
| v3b-politics-01 | politics | 认识论：实践检验 | basic | common-foundation | 待独立审校 |
| v3b-politics-02 | politics | 唯物辩证法：具体分析 | intermediate | common-foundation | 待独立审校 |
| v3b-politics-03 | politics | 历史唯物主义：社会存在与意识 | advanced | common-foundation | 待独立审校 |
| v3b-major-01 | major | 研究方法：对照实验 | basic | common-foundation | 待独立审校 |
| v3b-major-02 | major | 研究方法：相关与因果 | intermediate | common-foundation | 待独立审校 |
| v3b-major-03 | major | 研究方法：外部效度 | advanced | common-foundation | 待独立审校 |
