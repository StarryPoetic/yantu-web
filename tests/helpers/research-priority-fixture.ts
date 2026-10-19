/** Synthetic public evidence only. Fake personal cells exercise removal, never a real roster. */
export function priorityFixturePages(school: {
  name: string;
  registrableDomain: string;
  city: string;
}) {
  const pages: { url: string; title: string; text: string }[] = [];
  const add = (path: string, title: string, text: string) =>
    pages.push({
      url: `https://${school.registrableDomain}/offline-priority/${path}`,
      title: `${school.name}${title}`,
      text: `${school.name}${title}\n${text}\n版权所有 ${school.name}`,
    });
  for (const year of [2026, 2025, 2024]) {
    add(
      `scores-${year}`,
      `${year}年硕士研究生复试基本分数线`,
      "学院 | 专业代码 | 专业名称 | 总分（满分500分） | 单科（满分100分） | 单科（满分大于100分）\n机械工程学院 | 080200 | 机械工程 | 330 | 50 | 75\n控制学院 | 081100 | 控制科学与工程 | 360 | 55 | 80",
    );
    add(
      `roster-${year}`,
      `${year}年硕士研究生拟录取名单`,
      "学院 | 专业代码 | 专业名称 | 姓名 | 考生编号 | 录取方式 | 初试总分（满分500分） | 录取状态\n机械工程学院 | 080200 | 机械工程 | 模拟甲 | 123456789000001 | 统考 | 340 | 拟录取\n机械工程学院 | 080200 | 机械工程 | 模拟乙 | 123456789000002 | 统考 | 355 | 拟录取\n机械工程学院 | 080200 | 机械工程 | 模拟丙 | 123456789000003 | 推免 | — | 拟录取",
    );
  }
  add(
    "competition",
    "2026年全日制硕士研究生报录统计",
    "学院 | 专业代码 | 专业名称 | 一志愿报考人数 | 一志愿实际录取人数\n机械工程学院 | 080200 | 机械工程 | 120 | 30",
  );
  add(
    "background",
    "2026年硕士研究生生源质量报告",
    "2026年机械工程学院080200机械工程硕士研究生实际录取新生中，双非本科生20人。\n2026年机械工程学院080200机械工程硕士研究生实际录取新生中，跨专业考生10人。",
  );
  add(
    "academic",
    "2026年硕士研究生第四轮学科评估与专业排名",
    "学科代码 | 学科名称 | 评估等级\n080200 | 机械工程 | B+\n2026年080200机械工程专业排名第20。",
  );
  add(
    "employment",
    "2026年硕士毕业生就业质量报告",
    `2026年研究生院公布全校硕士毕业生就业率：96.5%，主要去向：制造业、科研院所。\n2026年080200机械工程服务${school.city}城市发展与制造产业。`,
  );
  // The unchanged synthetic profile can also produce a mechanical professional
  // degree recommendation. Give both revisions identical, separately coded rows.
  for (const page of pages)
    page.text = page.text
      .split("\n")
      .flatMap((line) =>
        line.includes("080200")
          ? [
              line,
              line
                .replaceAll("080200", "085500")
                .replaceAll("085500机械工程", "085500机械")
                .replaceAll("085500 | 机械工程", "085500 | 机械")
                .replace(/12345678900000([123])/g, "12345678900001$1"),
            ]
          : [line],
      )
      .join("\n");
  return pages;
}
export function matchingPriorityPages(
  pages: ReturnType<typeof priorityFixturePages>,
  query: string,
) {
  if (/招生专业目录/.test(query)) return [];
  const year = query.match(/20\d{2}年/)?.[0].slice(0, 4) ?? "2026";
  const paths = /复试基本分数线/.test(query)
    ? [`scores-${year}`]
    : /报录比|报录统计/.test(query)
      ? ["competition", `roster-${year}`]
      : /拟录取名单/.test(query)
        ? [`roster-${year}`]
        : /生源质量/.test(query)
          ? ["background"]
          : /第四轮学科评估/.test(query)
            ? ["academic"]
            : /就业质量报告/.test(query)
              ? ["employment"]
              : [];
  return pages.filter((p) => paths.some((path) => p.url.endsWith("/" + path)));
}
