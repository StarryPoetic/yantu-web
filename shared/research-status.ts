const messages: Record<string, string> = {
  WEB_REDIRECT_CROSS_SITE: "网页跳转到其他学校或未允许的主机，已拒绝读取。",
  WEB_REDIRECT_LIMIT: "网页跳转超过上限或出现循环，已停止读取。",
  WEB_DECODE_FAILED: "网页压缩内容损坏，无法解压读取。",
  WEB_TLS_CERT: "网页 TLS 证书校验失败，已拒绝读取。",
  WEB_CONNECTION_RESET: "网页连接被重置或中途断开。",
  WEB_CONNECTION_REFUSED: "网页服务器拒绝连接。",
  WEB_DNS_INVALID_RESPONSE: "网页 DNS 返回无效或不可用的解析结果。",
  WEB_DNS_TIMEOUT: "网页 DNS 解析超时。",
  WEB_DNS_UNAVAILABLE: "网页 DNS 解析服务暂不可用。",
  HTTP_403: "网页服务器拒绝访问（403）。",
  HTTP_404: "网页不存在（404）。",
  HTTP_410: "网页已移除（410）。",
  HTTP_429: "网页请求过于频繁（429）。",
  HTTP_4XX: "网页服务器未接受请求（4xx）。",
  HTTP_500: "网页服务器内部错误（500）。",
  HTTP_502: "网页网关错误（502）。",
  HTTP_503: "网页服务暂不可用（503）。",
  HTTP_504: "网页网关超时（504）。",
  HTTP_5XX: "网页服务器故障（5xx）。",

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
  RESEARCH_PROFILE_REQUIRED:
    "请补充兴趣、职业目标与个人约束，再形成具体学校专业建议。",
  RESEARCH_DIRECTION_NOT_ALLOWED:
    "研究方向与已排除专业或明确的跨专业约束不符，请核对偏好后重试。",
  INVALID_RESEARCH_PLAN:
    "模型返回的方向规划格式未通过校验，请重试生成，无需重新填写画像。",
  INVALID_RESEARCH_REPORT:
    "模型返回的报告格式未通过校验，请重试生成，无需先选择学校或专业。",
  UNGROUNDED_PROFILE_FIT:
    "模型返回的部分匹配理由未能对应到当前画像，本次生成未完成。",
  INSUFFICIENT_PROFILE_FIT:
    "匹配理由未充分说明你的目标与约束，暂未采用该建议。",
  RESEARCH_EVIDENCE_EXCLUDED:
    "资料含示例或停招信息，暂不能支持该学校专业建议。",
  RESEARCH_PARTIAL_VALIDATION:
    "部分内容未通过来源或画像核对，已保留其余可核对的建议。",
  KNOWN_ADMISSION_CONFLICT:
    "目标年度资料明确的报考条件与你的背景冲突，已移除该建议。",
  NO_WEB_EVIDENCE: "尚未取得可引用的网页资料，不能生成院校研究结论。",
  SEARCH_SNIPPETS_ONLY: "目前只有搜索摘要，尚需核对对应学校的官网原文。",
  INSUFFICIENT_RESEARCH_EVIDENCE:
    "资料覆盖不足，暂不能形成完整的学校与专业建议。",
  PREFERRED_CITY_COVERAGE_INCOMPLETE:
    "已取得部分学校资料，但可核验的意向城市学校建议仍不足；这不代表意向城市没有适合的学校。",
  ADMISSION_EVIDENCE_NOT_APPLICABLE:
    "部分资料的目标年度或招生适用性尚未核实，相关资格摘录与学校建议已移除。",
  BUDGET_EXHAUSTED: "今日模型额度不足，请调整服务额度或稍后再试。",
  CONCURRENCY_LIMIT: "当前模型服务繁忙，请稍后再试。",
  EVIDENCE_TOO_LARGE: "本次资料较多，暂无法在当前额度内完成分析。",
  PROVIDER_AUTH_FAILED: "模型服务认证未通过，请检查服务端配置。",
  PROVIDER_BALANCE_INSUFFICIENT:
    "模型服务账户余额不足，服务管理员充值后可重试；无需修改画像。",
  PROVIDER_INVALID_REQUEST:
    "模型服务未接受请求格式或参数，请联系维护者检查服务端配置；无需重填画像。",
  PROVIDER_TEMPORARY_UNAVAILABLE:
    "模型服务暂时故障，本次生成未完成，请稍后重试。",
  PROVIDER_NETWORK_ERROR:
    "连接模型服务失败或中途断开，请检查服务器网络后重试。",
  PROVIDER_DNS_UNAVAILABLE:
    "连接模型服务失败或中途断开，请检查服务器网络后重试。",
  PROVIDER_UNAVAILABLE:
    "模型服务未完成本次请求，请检查服务状态与配置；无需修改画像。",
  INVALID_RESPONSE: "模型服务返回的数据无法读取，请稍后重试；无需修改画像。",
  RESPONSE_TOO_LARGE:
    "模型响应超过本次传输或正文长度上限，生成未完成；请重试或联系维护者，无需修改画像。",
  INCOMPLETE_RESPONSE:
    "模型输出被截断或未正常结束，本次生成未完成；请稍后重试，无需修改画像。",
  UNKNOWN_USAGE:
    "模型服务未返回有效的用量记录，本次生成未完成；请稍后重试，无需修改画像。",
  RATE_LIMITED: "模型服务请求较多，请稍后再试。",
  TIMEOUT: "本次模型分析超时，已保留可查看的网页资料。",
  RESEARCH_TOTAL_TIMEOUT:
    "本次研究超过总时限，已保留已取得的资料和完成阶段；可一键重试继续生成。",
  MODEL_UNAVAILABLE: "模型分析暂未完成，已保留通过核对的建议与资料，可重试。",
  MODEL_TIMEOUT: "本次模型分析超时，已保留可查看的网页资料。",
  WEB_TIMEOUT: "网页读取超时。",
  WEB_EMPTY: "网页未返回可用正文。",
  WEB_PDF_INVALID: "PDF 格式损坏、加密或暂不能解析，已保留搜索摘要。",
  WEB_PDF_TIMEOUT: "PDF 文本解析超时，已保留搜索摘要。",
  WEB_PDF_TOO_MANY_PAGES: "PDF 页数超过本次读取上限，尚未取得完整正文。",
  WEB_PDF_TEXT_TOO_LARGE: "PDF 文字量超过本次读取上限，尚未取得完整正文。",
  WEB_PDF_EMPTY: "PDF 没有可提取的文字，可能需要人工查看扫描件。",
  WEB_UNAVAILABLE: "网页暂时无法访问。",
  WEB_REDIRECT_BLOCKED: "网页跳转到了其他地址，暂未取得正文。",
};
export function researchReason(reason: string) {
  return (
    messages[reason] ??
    (/^[A-Z][A-Z_\d]+$/.test(reason)
      ? "本次分析未通过完整性或来源核对，已保留可查看的资料。"
      : reason)
  );
}

export const RESEARCH_INPUT_LOCK_CODE = "research_inputs_locked";
export const RESEARCH_INPUT_LOCK_MESSAGE =
  "报告生成中，完成、失败或取消后可修改。";
