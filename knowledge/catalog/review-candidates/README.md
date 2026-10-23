# 真实资料待审包

本目录是从仓库已归档公开正文整理的待审材料，不是正式 catalog 导入目录，不由应用自动加载。不能把这些文件导入为已审核资料。

- `first-batch.json`：真实项目线索、原文定位及阻断检查项；所有项目保持 draft / unpublished / unverified，审核人为空。缺失身份保持 null。
- `evidence-audit.json`：最新真实运行五校固定分母的逐字段审计，并保留历史基线与累计正文离线结果。
- `import-hdu-2027-mechanical-draft.json`：杭电2027年010机械工程学院080200/085500的独立待审修订稿，仅复核已保存目录、表头和父公告附件链；不由下述审计命令生成或校验。所有claim仍unverified，原XLS及独立人工审核未补齐，不能导入为已审核资料或发布；新修订引用的旧稿保留在Git历史中，不表示已有前置修订入库。单独运行 `node --test tests/backend/catalog-review-import.test.ts tests/backend/catalog.test.ts tests/backend/rules.test.ts` 做离线结构、定位和隔离检查。

用 `node scripts/research-evidence-audit.ts --write` 重建，`--check` 校验一致性；不读取 `.env`，不调用网络、搜索或模型。手工审校记录应独立保存，不能编辑生成文件后指望下一次重建保留。

引用哈希覆盖归档中的 UTF-8 抽取文本，字偏移采用 JavaScript UTF-16 字符位置；不是原 PDF/XLS 文件哈希。正式导入前须补原件、使用限制、完整身份、目标年度适用性，并由真实独立复核人员审核。执行流程见上级 `README.md`。

本阶段验收可追溯正例与负例、国家线链条及学科范围门禁、小批多画像回放和确认/待补变化。三项60%覆盖率保留为后续质量目标，不触发自动付费调用，不作为本阶段交付条件。
