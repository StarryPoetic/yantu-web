import { createServer } from "vite";
import { createApplication } from "../server/app.ts";
const args = process.argv.slice(2);
const portIndex = args.indexOf("--port");
const port = portIndex >= 0 ? Number(args[portIndex + 1]) : 4173;
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("请输入 1–65535 的有效端口。");
const app = await createApplication(
  process.env.YANTU_ORIGIN
    ? {}
    : { origins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`] },
);
await new Promise((resolve) => app.server.listen(0, "127.0.0.1", resolve));
const apiPort = app.server.address().port;
const vite = await createServer({
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
    proxy: { "/api": `http://127.0.0.1:${apiPort}` },
  },
});
await vite.listen();
vite.printUrls();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    void Promise.all([vite.close(), app.close()]).finally(() =>
      process.exit(0),
    );
  });
