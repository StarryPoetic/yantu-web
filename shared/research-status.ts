const messages: Record<string, string> = {
  MODEL_DISABLED: "模型服务尚未启用。",
  MODEL_NOT_CONFIGURED: "尚未配置模型服务密钥。",
  SEARCH_DISABLED: "网页搜索服务尚未启用。",
  SEARCH_NOT_CONFIGURED: "尚未配置网页搜索密钥。",
  SEARCH_BUDGET_EXHAUSTED: "今日网页搜索次数已用完，请稍后再试。",
  SEARCH_INVALID_RESPONSE: "搜索服务返回的资料暂时无法读取。",
  SEARCH_UNAVAILABLE: "网页搜索暂时不可用，请检查服务状态与账户额度。",
  SEARCH_PROVIDER_ERROR: "搜索服务未接受本次请求，请检查密钥、余额和调用额度。",
  SEARCH_PROVIDER_INVALID: "搜索服务配置无效，请检查服务端设置。",
  RESEARCH_FOCUS_REQUIRED: "请补充兴趣或确认专业方向，再调查相关学校。",
  NO_WEB_EVIDENCE: "尚未取得可引用的网页资料，不能生成院校研究结论。",
  SEARCH_SNIPPETS_ONLY: "目前只有搜索摘要，尚需核对对应学校的官网原文。",
  INSUFFICIENT_RESEARCH_EVIDENCE:
    "资料覆盖不足，暂不能形成完整的学校与专业建议。",
  ADMISSION_EVIDENCE_NOT_APPLICABLE:
    "部分资料的目标年度或招生适用性尚未核实，相关资格摘录与学校建议已移除。",
  BUDGET_EXHAUSTED: "今日模型额度不足，请调整服务额度或稍后再试。",
  CONCURRENCY_LIMIT: "当前模型服务繁忙，请稍后再试。",
  EVIDENCE_TOO_LARGE: "本次资料较多，暂无法在当前额度内完成分析。",
  PROVIDER_AUTH_FAILED: "模型服务认证未通过，请检查服务端配置。",
  RATE_LIMITED: "模型服务请求较多，请稍后再试。",
  TIMEOUT: "本次模型分析超时，已保留可查看的网页资料。",
  MODEL_TIMEOUT: "本次模型分析超时，已保留可查看的网页资料。",
  WEB_TIMEOUT: "网页读取超时。",
  WEB_EMPTY: "网页未返回可用正文。",
  WEB_UNAVAILABLE: "网页暂时无法访问。",
  WEB_REDIRECT_BLOCKED: "网页跳转到了其他地址，暂未取得正文。",
};
export function researchReason(reason: string) {
  return (
    messages[reason] ??
    (/^[A-Z][A-Z_]+$/.test(reason)
      ? "本次分析未通过完整性或来源核对，已保留可查看的资料。"
      : reason)
  );
}
