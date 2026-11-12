import { tmpdir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Only non-secret platform metadata is needed for this disposable test site. */
export function renderPreviewEnvironment(
  externalUrl: string | undefined,
  temporaryDirectory = tmpdir(),
) {
  let url: URL;
  try {
    url = new URL(externalUrl ?? "");
  } catch {
    throw new Error("Render 测试站需要平台提供 HTTPS RENDER_EXTERNAL_URL。");
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".onrender.com") ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error("Render 测试站仅接受平台提供的 HTTPS onrender.com 来源。");
  if (!isAbsolute(temporaryDirectory))
    throw new Error("测试站临时数据库目录必须是绝对路径。");
  return {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    YANTU_ORIGIN: url.origin,
    YANTU_DATABASE_PATH: resolve(
      temporaryDirectory,
      "yantu-render-preview",
      "preview.sqlite",
    ),
    YANTU_PREVIEW_MODE: "true",
    YANTU_SAMPLE_DATA: "true",
    YANTU_MODEL_ENABLED: "false",
    YANTU_SEARCH_ENABLED: "false",
    YANTU_ADMIN_CREDENTIALS: "[]",
    YANTU_BOOTSTRAP_ADMINS: "[]",
    YANTU_TRUSTED_PROXY_IPS: "",
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  Object.assign(
    process.env,
    renderPreviewEnvironment(process.env.RENDER_EXTERNAL_URL),
  );
  console.log(
    "免费测试环境：数据会在休眠、重启或重新部署后清除；模型与搜索关闭。",
  );
  await import("../server/start.ts");
}
