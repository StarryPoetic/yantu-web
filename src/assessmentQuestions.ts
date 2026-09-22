export type AssessmentSubject = "数学" | "英语" | "政治" | "计算机专业基础";

export interface AssessmentQuestion {
  id: string;
  subject: AssessmentSubject;
  point: string;
  text: string;
  options: string[];
  correct: number;
  explanation: string;
  source: string;
}

export const publicSubjects: AssessmentSubject[] = ["数学", "英语", "政治"];
export const assessmentQuestions: AssessmentQuestion[] = [
  {
    id: "v2-m1",
    subject: "数学",
    point: "导数的基本运算",
    text: "已知 f(x) = x² + 3x，f′(2) 的值为？",
    options: ["4", "5", "7", "10"],
    correct: 2,
    explanation:
      "根据幂函数求导法则与导数的线性性质，f′(x) = 2x + 3，代入 x = 2 得到 7。",
    source: "高等数学：导数的基本运算法则",
  },
  {
    id: "v2-m2",
    subject: "数学",
    point: "定积分与基本定理",
    text: "定积分 ∫₀¹ 2x dx 的值为？",
    options: ["0", "1", "2", "1/2"],
    correct: 1,
    explanation:
      "2x 的一个原函数为 x²。根据牛顿—莱布尼茨公式，结果为 1² − 0² = 1。",
    source: "高等数学：微积分基本定理",
  },
  {
    id: "v2-m3",
    subject: "数学",
    point: "函数极限",
    text: "当 x 趋近于 0 时，sin x / x 的极限为？（x 使用弧度制）",
    options: ["0", "不存在", "无穷大", "1"],
    correct: 3,
    explanation:
      "这是三角函数的基本极限 lim(x→0) sin x / x = 1，前提是角度采用弧度制。",
    source: "高等数学：三角函数基本极限",
  },
  {
    id: "v2-m4",
    subject: "数学",
    point: "线性代数：行列式",
    text: "一个 2 × 2 对角矩阵的对角元素依次为 2、3，其行列式为？",
    options: ["6", "5", "1", "0"],
    correct: 0,
    explanation:
      "二阶行列式为 ad − bc；对角矩阵的两个非对角元素均为 0，所以行列式为 2 × 3 = 6。",
    source: "线性代数：二阶行列式定义",
  },
  {
    id: "v2-m5",
    subject: "数学",
    point: "概率：独立事件",
    text: "事件 A、B 相互独立，P(A) = 0.5，P(B) = 0.4。P(A ∩ B) 为？",
    options: ["0.9", "0.1", "0.2", "0.5"],
    correct: 2,
    explanation:
      "独立事件同时发生的概率为各自概率的乘积，即 0.5 × 0.4 = 0.2。独立并不表示互斥。",
    source: "概率论：独立事件的乘法公式",
  },
  {
    id: "v2-e1",
    subject: "英语",
    point: "阅读：让步关系",
    text: "“Although the task was difficult, she completed it on time.” 这句话表达了什么？",
    options: [
      "任务很简单，因此她提前完成",
      "虽然任务很难，她仍按时完成",
      "因为任务很难，她没有完成",
      "她还没有开始这项任务",
    ],
    correct: 1,
    explanation:
      "Although 引导让步状语从句，说明任务很难；主句 completed it on time 明确表达她仍然按时完成。",
    source: "英语语法：Although 引导的让步状语从句",
  },
  {
    id: "v2-e2",
    subject: "英语",
    point: "词汇：语境理解",
    text: "“Regular practice is essential for progress.” 中 essential 的意思是？",
    options: ["必要的", "偶然的", "复杂的", "暂时的"],
    correct: 0,
    explanation:
      "essential 表示“必不可少的、必要的”，句子强调持续练习对进步的必要性。",
    source: "英语词汇：essential 的基本释义",
  },
  {
    id: "v2-e3",
    subject: "英语",
    point: "语法：主谓一致",
    text: "选择合适的词填空：The results of the experiment ___ encouraging.",
    options: ["is", "was", "are", "has"],
    correct: 2,
    explanation:
      "句子的主语是复数名词 results，of the experiment 是修饰语，因此应使用复数形式 are。",
    source: "英语语法：主谓一致与介词短语修饰语",
  },
  {
    id: "v2-e4",
    subject: "英语",
    point: "阅读：因果关系",
    text: "“The library extended its opening hours, so students had more time to study there.” 学生有更多学习时间的原因是？",
    options: [
      "学生减少了课程",
      "图书馆搬到了新校区",
      "图书馆减少了书籍",
      "图书馆延长了开放时间",
    ],
    correct: 3,
    explanation:
      "so 连接原因与结果。前半句 extended its opening hours 表示延长开放时间，是后半句结果的直接原因。",
    source: "英语阅读：由 so 连接的因果关系",
  },
  {
    id: "v2-e5",
    subject: "英语",
    point: "词汇：指代与近义",
    text: "“The new method reduces the time needed for the task.” 中 reduces 最接近哪个词？",
    options: ["increases", "decreases", "ignores", "records"],
    correct: 1,
    explanation:
      "reduces 在此表示“减少”，与 decreases 意义接近。increases 表示增加，ignores 表示忽略，records 表示记录。",
    source: "英语词汇：reduce 与 decrease 的基本释义",
  },
  {
    id: "v2-p1",
    subject: "政治",
    point: "哲学：实践与认识",
    text: "在马克思主义认识论中，检验认识真理性的唯一标准是？",
    options: ["个人感受", "实践", "多数人的赞同", "表达是否流畅"],
    correct: 1,
    explanation:
      "实践把主观认识与客观实际联系起来，能够检验认识是否与客观实际相符合，因此是检验认识真理性的唯一标准。",
    source: "马克思主义基本原理：实践是检验真理的唯一标准",
  },
  {
    id: "v2-p2",
    subject: "政治",
    point: "哲学：量变与质变",
    text: "关于量变与质变的关系，下列说法正确的是？",
    options: [
      "任何微小量变都立即引起质变",
      "质变完全不需要量变积累",
      "量变是质变的必要准备，质变是量变的必然结果",
      "量变与质变毫无关联",
    ],
    correct: 2,
    explanation:
      "量变为质变作必要准备；量变达到一定程度、突破事物的度时发生质变。并非任何一次微小变化都会立即改变事物性质。",
    source: "马克思主义基本原理：量变质变规律",
  },
  {
    id: "v2-p3",
    subject: "政治",
    point: "哲学：矛盾特殊性",
    text: "面对不同学生的学习困难，分别分析原因并制定不同方案，体现了哪种方法？",
    options: [
      "具体问题具体分析",
      "所有情况套用同一方案",
      "只看表面现象",
      "拒绝分析条件",
    ],
    correct: 0,
    explanation:
      "不同对象、阶段与条件中的矛盾各有特点。针对具体条件分析问题并选择相应方法，体现了具体问题具体分析。",
    source: "马克思主义基本原理：矛盾特殊性与具体问题具体分析",
  },
  {
    id: "v2-p4",
    subject: "政治",
    point: "哲学：联系的条件性",
    text: "“联系是有条件的”意味着什么？",
    options: [
      "任意两个事物都有直接联系",
      "联系完全由个人意愿决定",
      "只要同时出现就一定有因果关系",
      "具体联系依赖一定条件，应结合条件进行分析",
    ],
    correct: 3,
    explanation:
      "联系具有条件性，具体联系的形成和作用依赖一定条件。不能主观臆造联系，也不能仅凭同时出现就认定因果关系。",
    source: "马克思主义基本原理：联系的客观性与条件性",
  },
  {
    id: "v2-p5",
    subject: "政治",
    point: "哲学：认识的发展",
    text: "“实践—认识—再实践—再认识”主要说明了认识过程的哪一特点？",
    options: [
      "认识一经形成就永远不变",
      "认识在实践基础上反复发展、不断深化",
      "认识不需要实际检验",
      "认识只能来自直接经验",
    ],
    correct: 1,
    explanation:
      "认识从实践中产生，又回到实践接受检验，并在新的实践中得到发展。这个过程体现了认识的反复性和不断深化。",
    source: "马克思主义基本原理：实践与认识的辩证运动",
  },
  {
    id: "v2-c1",
    subject: "计算机专业基础",
    point: "数据结构：栈",
    text: "元素 A、B、C 依次入栈，期间没有出栈操作。随后连续出栈，顺序是什么？",
    options: ["A、B、C", "B、A、C", "C、B、A", "C、A、B"],
    correct: 2,
    explanation: "栈遵循“后进先出”规则。C 最后入栈，先出栈，之后依次为 B、A。",
    source: "数据结构：栈的后进先出特性",
  },
  {
    id: "v2-c2",
    subject: "计算机专业基础",
    point: "算法：二分查找",
    text: "在有序数组中进行二分查找，其最坏时间复杂度为？",
    options: ["O(1)", "O(log n)", "O(n)", "O(n²)"],
    correct: 1,
    explanation:
      "每次比较都将待查区间缩小约一半。经过约 log₂n 次比较，区间缩小为一个元素。",
    source: "数据结构：有序数组二分查找的复杂度分析",
  },
  {
    id: "v2-c3",
    subject: "计算机专业基础",
    point: "数据结构：队列",
    text: "元素 A、B、C 依次进入一个空的普通队列，首次出队的元素是？",
    options: ["A", "B", "C", "无法确定"],
    correct: 0,
    explanation:
      "普通队列遵循“先进先出”规则。A 最先进入队列，因此首次出队的是 A。",
    source: "数据结构：队列的先进先出特性",
  },
  {
    id: "v2-c4",
    subject: "计算机专业基础",
    point: "计算机基础：二进制",
    text: "二进制数 1010 对应的十进制数是？",
    options: ["8", "9", "12", "10"],
    correct: 3,
    explanation:
      "从右向左的位权是 1、2、4、8，所以 1010₂ = 1 × 8 + 0 × 4 + 1 × 2 + 0 × 1 = 10。",
    source: "计算机组成原理：二进制与十进制转换",
  },
  {
    id: "v2-c5",
    subject: "计算机专业基础",
    point: "算法：顺序遍历",
    text: "一个循环恰好访问长度为 n 的数组中的每个元素一次，每次执行常数时间操作，其时间复杂度为？",
    options: ["O(1)", "O(log n)", "O(n)", "O(n²)"],
    correct: 2,
    explanation:
      "共执行 n 次常数时间操作，总用时随 n 线性增长，因此时间复杂度为 O(n)。",
    source: "数据结构与算法：线性遍历的时间复杂度",
  },
];
