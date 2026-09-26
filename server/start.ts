import { createApplication } from "./app.ts";
const app = await createApplication();
const port = Number(process.env.PORT ?? 8787);
app.server.listen(port, process.env.HOST ?? "127.0.0.1", () =>
  console.log(`研途服务已启动：http://127.0.0.1:${port}`),
);
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
