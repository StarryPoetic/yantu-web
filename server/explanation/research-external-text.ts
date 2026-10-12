import { redactAdmissionsText } from "./research-priority-tables.ts";
/** Do not retain forum feeds or incidental contact/author details from article sidebars. */
export function publicExternalText(text: string) {
  let skipAuthor = false;
  const lines: string[] = [];
  for (const line of redactAdmissionsText(text).split("\n")) {
    if (
      /论坛新帖|论坛热帖|热门话题.*论坛|网友评论|最新评论/.test(line) ||
      /^\s*(?:20\d{2}\s*)?考研论坛\s*$/.test(line)
    )
      break;
    if (/^\s*作者\s*$/.test(line)) {
      skipAuthor = true;
      continue;
    }
    if (skipAuthor && line.trim()) {
      skipAuthor = false;
      continue;
    }
    if (
      /联系人|联系电话|咨询电话|客服热线|客服邮箱|老师[^\n]*\d{7,8}|老\s*师[^\n]*\d{7,8}/.test(
        line,
      )
    )
      continue;
    lines.push(
      line.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "【邮箱已删除】"),
    );
  }
  return lines.join("\n");
}
