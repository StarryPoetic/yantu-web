/** A successful HTTP response can still be an explicit missing-content page.
 * Match only a standalone notice in a small text body, never a passing mention
 * in a report, an instruction, or a long archived document. */
export function researchContentRemoved(body: string) {
  return (
    body.length < 4000 &&
    /(?:^|\n)\s*(?:数据不存在或已过期|您访问的(?:页面|内容)(?:不存在|已删除)|该(?:页面|内容)已删除|内容已失效)[。！!]?\s*(?:\n|$)/u.test(
      body,
    )
  );
}
