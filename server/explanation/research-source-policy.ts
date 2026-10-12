import type { ResearchSourceTier } from "../../shared/research-source-tier.ts";
import type { ResearchPriorityField } from "../../shared/research-priority-facts.ts";
import { schoolRegistry } from "../schools/index.ts";

/** Exact hosts only. No wildcard trust for gov.cn, edu.cn, or a commercial parent domain. */
export const RESEARCH_EXTERNAL_SOURCES = [
  {
    host: "www.cdgdc.edu.cn",
    tier: "authority",
    reason: "教育部学位与研究生教育发展中心：学科评估发布机构",
    paths: ["/"],
  },
  {
    host: "cdgdc.edu.cn",
    tier: "authority",
    reason: "学位中心根域入口，与www入口同一机构",
    paths: ["/"],
  },
  {
    host: "yz.chsi.com.cn",
    tier: "authority",
    reason: "教育部学生服务与素质发展中心研招网：国家线和招生单位公开信息",
    paths: ["/kyzx/", "/sch/", "/zsml/", "/zsgs/", "/sswbgg/"],
  },
  {
    host: "yz.chsi.cn",
    tier: "authority",
    reason: "研招网教育网入口，仅限公开资讯与院校目录",
    paths: ["/kyzx/", "/sch/", "/zsml/", "/zsgs/"],
  },
  {
    host: "yzst.chsi.com.cn",
    tier: "authority",
    reason: "研招网公开资讯静态入口，排除报名及账号页面",
    paths: ["/kyzx/", "/sch/"],
  },
  {
    host: "www.moe.gov.cn",
    tier: "authority",
    reason: "教育部政府门户：招生政策和官方评估文件",
    paths: ["/jyb_"],
  },
  {
    host: "www.zjzs.net",
    tier: "authority",
    reason: "浙江省教育考试院：本次杭州画像所在省的官方研考发布机构",
    paths: [
      "/col/",
      "/art/",
      "/moban/",
      "/picture/",
      "/plug-in/",
      "/module/download/",
    ],
  },
  {
    host: "www.eol.cn",
    tier: "reference",
    reason:
      "中国教育在线公开考研频道，提供历年报录资料；商业资讯，不作官方认证",
    paths: ["/e_ky/", "/ky/"],
  },
  {
    host: "kaoyan.eol.cn",
    tier: "reference",
    reason: "中国教育在线考研频道旧入口；只取公开资讯",
    paths: ["/"],
  },
  {
    host: "kaoyan.koolearn.com",
    tier: "reference",
    reason: "新东方在线公开考研资讯，有院校报录和复试信息；排除课程及登录内容",
    paths: ["/"],
  },
  {
    host: "yz.kaoyan.com",
    tier: "reference",
    reason: "考研帮院校资料频道，提供报录信息；不开放bbs论坛域名",
    paths: ["/"],
  },
] as const;

export const REFERENCE_PRIORITY_FIELDS: readonly ResearchPriorityField[] = [
  "cutoff",
  "applicationAdmissionRatio",
  "undergraduateAdmission",
  "crossMajorAdmission",
  "employment",
];

export function researchExternalPolicy(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      /[\\\s]/.test(value)
    )
      return;
    const raw = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
    if (raw?.toLowerCase() !== url.hostname) return;
    const path = decodeURIComponent(url.pathname);
    if (
      /login|passport|account|register|signin|forum|bbs|thread|member|comment|yzwb|user(?:\/|\.)/i.test(
        path,
      )
    )
      return;
    return RESEARCH_EXTERNAL_SOURCES.find(
      (p) =>
        p.host === url.hostname &&
        p.paths.some((prefix) => path.startsWith(prefix)),
    );
  } catch {
    return;
  }
}

export function researchSourceTier(
  value: string,
): ResearchSourceTier | undefined {
  const external = researchExternalPolicy(value);
  if (external) return external.tier;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return;
    // Explicit authority hosts cannot be downgraded to school trust on blocked paths.
    if (RESEARCH_EXTERNAL_SOURCES.some((p) => p.host === url.hostname)) return;
    if (schoolRegistry.byHost(url.hostname)) return "school";
  } catch {
    /* untrusted URL */
  }
}

export function externalFieldAllowed(
  tier: ResearchSourceTier,
  field: ResearchPriorityField,
) {
  return tier !== "reference" || REFERENCE_PRIORITY_FIELDS.includes(field);
}
