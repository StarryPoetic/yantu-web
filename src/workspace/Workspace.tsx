import { lazy, Suspense, useEffect, useState } from "react";
import {
  BookOpen,
  ClipboardCheck,
  Compass,
  Flag,
  GraduationCap,
  Heart,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { Resource, Session } from "./api";
import { ensureSession, request } from "./api";
import { loadCatalog } from "./catalog";
import type {
  Catalog,
  ProfileResource,
  Program,
  Recommendation,
  Selections,
  SelectionInput,
} from "./contracts";
import { CatalogPanel } from "./CatalogPanel";
import { Dialog, ErrorNotice } from "./ui";
import "./workspace.css";

const ProfilePanel = lazy(() =>
  import("./ProfilePanel").then((module) => ({ default: module.ProfilePanel })),
);
const AssessmentPanel = lazy(() =>
  import("./AssessmentPanel").then((module) => ({
    default: module.AssessmentPanel,
  })),
);
const PlanPanel = lazy(() =>
  import("./PlanPanel").then((module) => ({ default: module.PlanPanel })),
);
const AssistantPanel = lazy(() =>
  import("./AssistantPanel").then((module) => ({
    default: module.AssistantPanel,
  })),
);
const AdminPanel = lazy(() =>
  import("./AdminPanel").then((module) => ({ default: module.AdminPanel })),
);
const navigation = [
  { id: "explore", name: "择校探索", icon: Compass },
  { id: "profile", name: "个人画像", icon: UserRound },
  { id: "assessment", name: "基础测评", icon: ClipboardCheck },
  { id: "favorites", name: "我的收藏", icon: Heart },
  { id: "plan", name: "目标与规划", icon: Flag },
  { id: "assistant", name: "咨询助手", icon: Sparkles },
  { id: "admin", name: "资料管理", icon: ShieldCheck },
] as const;
type Page = (typeof navigation)[number]["id"];
function currentPage(): Page {
  const page = location.hash.slice(1);
  return navigation.some((item) => item.id === page)
    ? (page as Page)
    : "explore";
}
interface DeletionPreview {
  deletionScopeVersion: string;
  required: string[];
  retained: string[];
  deadline: string;
}
export default function Workspace() {
  const [page, setPage] = useState<Page>(currentPage),
    [session, setSession] = useState<Session | null>(null),
    [profile, setProfile] = useState<Resource<ProfileResource> | null>(null),
    [selections, setSelections] = useState<Resource<Selections> | null>(null),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [recommendation, setRecommendation] = useState<Recommendation | null>(null),
    [target, setTarget] = useState<Program | null>(null),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [generation, setGeneration] = useState(0),
    [deletion, setDeletion] = useState<DeletionPreview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [deleting, setDeleting] = useState(false),
    [notice, setNotice] = useState("");
  useEffect(() => {
    const onHash = () => setPage(currentPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    async function load() {
      const auth = await ensureSession();
      if (controller.signal.aborted) return;
      setSession(auth.data);
      const [profileResult, selectionResult, catalogResult] = await Promise.all(
        [
          request<ProfileResource>("/me/profile", {
            signal: controller.signal,
          }),
          request<Selections>("/me/selections", { signal: controller.signal }),
          loadCatalog(controller.signal).catch((error) => {
            if (controller.signal.aborted) throw error;
            setError(error);
            return {
              data: {
                catalogVersion: "尚未发布",
                items: [],
                coverage: {
                  description: "招生资料暂不可用",
                  limitations: ["仍可填写画像，管理人员可导入并发布审核资料。"],
                },
              } satisfies Catalog,
              etag: "",
            };
          }),
        ],
      );
      if (!controller.signal.aborted) {
        setProfile(profileResult);
        setSelections(selectionResult);
        setCatalog(catalogResult.data);
      }
    }
    void load()
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  function navigate(next: Page) {
    setPage(next);
    location.hash = next;
    window.scrollTo({ top: 0 });
  }
  async function reloadSelections() {
    const value = await request<Selections>("/me/selections");
    setSelections(value);
  }
  async function changeSelections(change: Partial<Selections>) {
    if (!selections) return;
    const current = { ...selections.data, ...change };
    const body: SelectionInput = {
      confirmedMajorId: current.confirmedMajorId,
      savedProgramIds: current.savedProgramIds,
      exclusions: current.exclusions,
      targetProgramId: current.targetProgramId,
    };
    const result = await request<Selections>("/me/selections", {
      method: "PUT",
      etag: selections.etag,
      body,
    });
    setSelections(result);
  }
  async function previewDeletion() {
    setError(null);
    try {
      const result = await request<DeletionPreview>(
        "/me/profile/deletion-preview",
      );
      setDeletion(result.data);
      setConfirmed(false);
    } catch (error) {
      setError(error);
    }
  }
  async function deleteProfile() {
    if (!deletion || !profile) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await request<{ jobId: string; status: string }>(
        "/me/profile",
        {
          method: "DELETE",
          etag: profile.etag,
          headers: { "Deletion-Scope-Version": deletion.deletionScopeVersion },
        },
      );
      const job = await request<{ status: string }>(
        `/me/jobs/${result.data.jobId}`,
      );
      setProfile(null);
      setSelections(null);
      setRecommendation(null);
      setTarget(null);
      setDeletion(null);
      setGeneration((value) => value + 1);
      setNotice(
        job.data.status === "succeeded"
          ? "个人资料及关联记录已删除。你可以重新开始。"
          : "删除作业已创建，可稍后查询完成状态。",
      );
      setReload((value) => value + 1);
      navigate("explore");
    } catch (error) {
      setError(error);
    } finally {
      setDeleting(false);
    }
  }
  const ready = profile && selections && catalog;
  return (
    <div className="workspace">
      <a
        className="ws-skip"
        href="#workspace-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("workspace-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <aside className="ws-sidebar">
        <button className="ws-brand" onClick={() => navigate("explore")}>
          <span>
            <GraduationCap size={27} />
          </span>
          <strong>
            研途<span>让选择，更有依据</span>
          </strong>
        </button>
        <div className="ws-sidebar-label">我的升学工作台</div>
        <nav aria-label="主要导航">
          {navigation.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              aria-label={name}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                setTarget(null);
                navigate(id);
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
              {id === "favorites" && (
                <small>{selections?.data.savedProgramIds.length ?? 0}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="ws-sidebar-note">
          <BookOpen size={22} />
          <strong>慢慢选，认真走。</strong>
          <p>专业与院校一起比较，适合你的方向可以逐步清晰。</p>
        </div>
        <div className="ws-session">
          <span className="ws-avatar">同</span>
          <div>
            <strong>{profile?.data.profile.name || "研途同学"}</strong>
            <small>游客会话 · 当前浏览器</small>
          </div>
        </div>
      </aside>
      <div className="ws-shell">
        <header className="ws-topbar">
          <span>
            我的工作台{" "}
            <span className="ws-muted">
              {" "}
              / {navigation.find((item) => item.id === page)?.name}
            </span>
          </span>
          <span className="ws-pill">
            <span className="ws-dot" />
            {session?.features.sampleData ? "示例资料环境" : "以审核资料为准"}
          </span>
        </header>
        <main id="workspace-content" className="ws-main" tabIndex={-1}>
          <ErrorNotice
            error={error}
            onReload={() => setReload((value) => value + 1)}
          />
          {notice && (
            <div className="ws-notice" role="status">
              {notice}
              <button className="ws-link" onClick={() => setNotice("")}>
                收起
              </button>
            </div>
          )}
          {loading ? (
            <div className="ws-loading" role="status">
              正在读取你的工作台…
            </div>
          ) : ready ? (
            <Suspense
              fallback={
                <div className="ws-loading" role="status">
                  正在打开页面…
                </div>
              }
            >
              <div key={`${generation}:${page}`} className="ws-stack">
                {(page === "explore" || page === "favorites") && (
                  <CatalogPanel
                    catalog={catalog}
                    profile={profile.data}
                    selections={selections.data}
                    onSelection={changeSelections}
                    onPlan={(program) => {
                      setTarget(program);
                      navigate("plan");
                    }}
                    recommendation={recommendation}
                    onRecommend={setRecommendation}
                    favorites={page === "favorites"}
                  />
                )}
                {page === "profile" && (
                  <ProfilePanel
                    resource={profile}
                    onSaved={setProfile}
                    onReload={() => {
                      void request<ProfileResource>("/me/profile")
                        .then((value) => {
                          setProfile(value);
                          setGeneration((current) => current + 1);
                        })
                        .catch(setError);
                    }}
                    onDelete={() => void previewDeletion()}
                  />
                )}
                {page === "assessment" && (
                  <AssessmentPanel
                    confirmedMajorId={selections.data.confirmedMajorId}
                  />
                )}
                {page === "plan" && (
                  <PlanPanel
                    selected={target}
                    programs={catalog.items ?? catalog.programs ?? []}
                    selections={selections.data}
                    recommendation={recommendation}
                    onSelectionsChanged={reloadSelections}
                  />
                )}
                {page === "assistant" && <AssistantPanel />}
                {page === "admin" && <AdminPanel />}
              </div>
            </Suspense>
          ) : (
            <div className="ws-panel">
              <h1>工作台暂时无法连接</h1>
              <p>
                请确认服务已启动，稍后重试。页面不会用离线演示内容代替真实记录。
              </p>
              <button
                className="ws-primary"
                onClick={() => setReload((value) => value + 1)}
              >
                重试连接
              </button>
            </div>
          )}
          <footer className="ws-footer">
            研途 · 用可追溯的资料，支持每一次选择。<span>不承诺录取结果</span>
          </footer>
        </main>
      </div>
      {deletion && (
        <Dialog
          title="确认删除个人资料"
          onClose={() => {
            if (!deleting) setDeletion(null);
          }}
        >
          <p>本次将删除以下个人记录：</p>
          <ul>
            {deletion.required.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p>保留：{deletion.retained.join("、")}</p>
          <p>{deletion.deadline}</p>
          <label className="ws-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            我已核对删除范围，确认删除
          </label>
          <button
            className="ws-danger-button"
            disabled={!confirmed || deleting}
            onClick={() => void deleteProfile()}
          >
            {deleting ? "正在删除…" : "确认删除全部个人资料"}
          </button>
        </Dialog>
      )}
    </div>
  );
}
