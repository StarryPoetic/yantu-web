import { lazy, Suspense } from "react";

// Example answers and local demo records are loaded only by explicit opt-in.
const Application =
  import.meta.env.DEV &&
  new URLSearchParams(window.location.search).get("demo") === "1"
    ? lazy(() => import("./DemoApp"))
    : lazy(() => import("./workspace/Workspace"));

export default function App() {
  return (
    <Suspense
      fallback={
        <main className="application-loading" role="status">
          正在打开研途工作台…
        </main>
      }
    >
      <Application />
    </Suspense>
  );
}
