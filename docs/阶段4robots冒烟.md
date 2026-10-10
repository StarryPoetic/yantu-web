# 阶段4 robots 免费冒烟记录

日期：2026-10-11。本记录对应 bced20d 之后的 RFC 9309 修正；此前两校事实质量记录仍作为历史记录保留。

命令：`node scripts/prefetch-schools.mjs --school 杭州师范大学 --db var/prefetch-robots-rfc9309.sqlite --dns-mode public-doh`。新临时库与日志位于 Git 忽略的 var 目录；默认每校20页、深度≤3、每主机间隔≥1秒。全程未调用付费搜索或模型，不打印配置值。

尝试1校20页，成功15页、失败5次、未过期跳过0页。robotsSkipped 0、robotsDisallowed 0、robotsUnavailable 0、robotsUnavailableByCode 空。失败为 HTTP_404 3次、WEB_FORMAT_UNSUPPORTED 2次，均是页面/附件读取失败，未再因 robots 解析失败跳过目录主机。

| 字段 | bound | pending |
| --- | ---: | ---: |
| catalog（目录） | 0 | 0 |
| exams（初试） | 0 | 0 |
| tuition（学费） | 0 | 0 |
| campus（校区/城市） | 0 | 0 |

目录专业代码数：0（事实表 catalog 去重代码）；事实总数：0。目录入口已读到，但静态正文缺少真实专业身份，因此也没有借用简章散文中的代码生成其他字段事实。

## 已读取的页面标题

| 序号 | 标题 | 来源 |
| --- | --- | --- |
| 1 | 杭州师范大学研究生招生信息网 | [原文](https://yjs.hznu.edu.cn/yjszs/) |
| 2 | 杭州师范大学2027年硕士研究生招生简章 | [原文](https://yjs.hznu.edu.cn/c/2026-09-29/3218599.shtml) |
| 3 | 杭州师范大学2027年硕士研究生招生专业目录 | [原文](https://yjsfw.hznu.edu.cn/open/zsss/ZsssTksList?zsnf=2027) |
| 4 | 杭州师范大学2027年接收推荐免试硕士研究生章程 | [原文](https://yjs.hznu.edu.cn/c/2026-09-16/3217391.shtml) |
| 5 | 杭州师范大学2027年硕士研究生招生考试科目 | [原文](https://yjsfw.hznu.edu.cn/open/zsss/ZsssKskmList?zsnf=2027) |
| 6 | 招生简章（硕士栏目） | [原文](https://yjs.hznu.edu.cn/yjszs/sszsjz/zsjz/) |
| 7 | 杭州师范大学2026年硕士研究生招生简章 | [原文](https://yjs.hznu.edu.cn/c/2025-09-28/3113195.shtml) |
| 8 | 杭州师范大学2026年硕士研究生招生专业目录（点击查看） | [原文](https://yjsfw.hznu.edu.cn/open/zsss/ZsssTksList?zsnf=2026) |
| 9 | 杭州师范大学2025年硕士研究生招生简章 | [原文](https://yjs.hznu.edu.cn/c/2024-09-30/3006021.shtml) |
| 10 | 杭州师范大学2024年硕士研究生招生简章 | [原文](https://yjs.hznu.edu.cn/c/2023-09-19/2873335.shtml) |
| 11 | 《杭州师范大学2025年接收推荐免试硕士研究生章程》 | [原文](https://yjs.hznu.edu.cn/c/2024-09-28/3004481.shtml) |
| 12 | 杭州师范大学2026年硕士研究生招生考试科目（点击查看） | [原文](https://yjsfw.hznu.edu.cn/open/zsss/ZsssKskmList?zsnf=2026) |
| 13 | 招生简章（博士栏目） | [原文](https://yjs.hznu.edu.cn/yjszs/bsszs/zsjz/) |
| 14 | 硕士招生动态 | [原文](https://yjs.hznu.edu.cn/yjszs/sszsjz/) |
| 15 | 2027年硕士研究生招生考试（初试）招生目录拟调整公告（持续更新中） | [原文](https://yjs.hznu.edu.cn/c/2026-06-01/3204284.shtml) |

## 目录主机诊断与安全降级

额外免费只读核验沿用阶段1 reader、公网 DNS 与 public-doh。`https://yjsfw.hznu.edu.cn/robots.txt` 实际状态200，未提供 Content-Type 响应头，内容是 HTML，没有可解析的 robots 规则。内容前200字经查询令牌遮蔽后的片段如下（没有个人信息，令牌未写入记录）：

```html
<html>
<head>
<script>
    var sfDomainParam = "";
    var locationUrl = "https://atrust.hznu.edu.cn:443/controller/v1/public/verify?t=[已遮蔽]"
```

这不是 HTTP Location 跳转；未执行 JavaScript 跳转或请求验证地址。按逐行解析策略，该响应没有有效限制，目录主机获准读取。

2027专业目录入口实际状态200、Content-Type 为 text/html，HTML 9770字符、21个 script 标签，提取后的静态正文13字：“研究生教育数据赋能管理系统”。2027考试科目入口及2026两个目录/科目入口的入库静态正文同样只有这13字。现有公开 GET 读取不足以得到专业表格，继续安全降级；不执行脚本、不登录、不绕过验证、不探测隐藏接口。目录事实0并非 robots 再次误伤，也不能以简章零星代码补齐目录身份。

失败明细：2025目录/考试科目 `/tjfx/open/zsss/ZsssTksList?zsnf=2025`、`/tjfx/open/zsss/ZsssKskmList?zsnf=2025` 返回 WEB_FORMAT_UNSUPPORTED；2024简章所链接的 `7791795.pdf`、`7792175.pdf`、`7791768.rar` 返回 HTTP_404。

数据库核验：15条公共原文、20条读取尝试、0条专业事实；完整性 ok、外键问题0。研招网没有新增探测，仍沿用实施说明13.5的脚本渲染安全降级结论。
