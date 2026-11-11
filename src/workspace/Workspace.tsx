import { ResearchProvider, useResearch } from "./ResearchContext";
import { RESEARCH_INPUT_LOCK_MESSAGE } from "../../shared/research-status";
import { lazy, Suspense, useEffect, useState } from "react";
import {
  BookOpen,
  ArrowRight,
  ClipboardCheck,
  Compass,
  Flag,
  GraduationCap,
  Heart,
  LogOut,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import type { Resource, Session } from "./api";
import { ensureSession, request, resetSession, acceptSession } from "./api";
import { AuthScreen } from "./AuthScreen";
import { AccountSecurity } from "./AccountSecurity";
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
import "./journey.css";
import { clearProfileDraft } from "./profile-draft";
import {
  ResearchInterestsProvider,
  useResearchInterests,
} from "./ResearchInterests";

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
const FloatingAssistant = lazy(() =>
  import("./AssistantPanel").then((module) => ({
    default: module.FloatingAssistant,
  })),
);
const GuidancePanel = lazy(() =>
  import("./GuidancePanel").then((module) => ({
    default: module.GuidancePanel,
  })),
);
const AdminPanel = lazy(() =>
  import("./AdminPanel").then((module) => ({ default: module.AdminPanel })),
);
const navigation = [
  { id: "profile", name: "个人画像", icon: UserRound },
  { id: "assessment", name: "基础测评", icon: ClipboardCheck },
  { id: "guidance", name: "推荐结论", icon: Sparkles },
  { id: "explore", name: "专业与院校", icon: Compass },
  { id: "favorites", name: "我的收藏", icon: Heart },
  { id: "plan", name: "目标与规划", icon: Flag },
] as const;
type Page = (typeof navigation)[number]["id"];
function currentPage(): Page {
  const page = location.hash.slice(1);
  return navigation.some((item) => item.id === page)
    ? (page as Page)
    : "profile";
}
interface DeletionPreview {
  deletionScopeVersion: string;
  required: string[];
  retained: string[];
  deadline: string;
}
export default function Workspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<unknown>();
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const expired = () => {
      resetSession();
      setSession(null);
      setError(null);
      setReload((value) => value + 1);
    };
    window.addEventListener("yantu-session-expired", expired);
    return () => window.removeEventListener("yantu-session-expired", expired);
  }, []);
  useEffect(() => {
    let active = true;
    void ensureSession()
      .then((result) => {
        if (active) {
          acceptSession(result.data);
          setSession(result.data);
        }
      })
      .catch((failure) => {
        if (active) setError(failure);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  async function logout() {
    try {
      await request("/auth/logout", { method: "POST", body: {} });
      resetSession();
      setSession(null);
      location.hash = "";
      setReload((value) => value + 1);
    } catch (failure) {
      setError(failure);
    }
  }
  if (!session)
    return (
      <main className="ws-auth-loading">
        <h1>研途</h1>
        <ErrorNotice
          error={error}
          onReload={() => {
            resetSession();
            setError(null);
            setReload((value) => value + 1);
          }}
        />
        {!error && <p role="status">正在确认登录状态…</p>}
      </main>
    );
  if (!session.authenticated || !session.user)
    return <AuthScreen session={session} onAuthenticated={setSession} />;
  if (session.user.role === "admin")
    return (
      <div className="workspace ws-admin-workspace">
        <header className="ws-topbar">
          <strong>
            <ShieldCheck size={20} /> 研途 · 管理工作台
          </strong>
          <span>{session.user.username}</span>
          <AccountSecurity session={session} onSession={setSession} />
          <button className="ws-secondary" onClick={() => void logout()}>
            <LogOut size={16} />
            退出登录
          </button>
        </header>
        <main className="ws-main">
          <ErrorNotice error={error} />
          <Suspense fallback={<p role="status">正在打开管理工作台…</p>}>
            <AdminPanel />
          </Suspense>
        </main>
      </div>
    );
  return (
    <ResearchProvider key={session.user.accountId}>
      <ResearchInterestsProvider>
        <SignedInWorkspace
          key={session.user.accountId}
          session={session}
          onSession={setSession}
          onLogout={() => void logout()}
          globalError={error}
        />
      </ResearchInterestsProvider>
    </ResearchProvider>
  );
}

function SignedInWorkspace({
  session,
  onSession,
  onLogout,
  globalError,
}: {
  session: Session;
  onSession: (session: Session) => void;
  onLogout: () => void;
  globalError?: unknown;
}) {
  const research = useResearch();
  const interests = useResearchInterests();
  const [page, setPage] = useState<Page>(currentPage),
    [profile, setProfile] = useState<Resource<ProfileResource> | null>(null),
    [selections, setSelections] = useState<Resource<Selections> | null>(null),
    [catalog, setCatalog] = useState<Catalog | null>(null),
    [recommendation, setRecommendation] = useState<Recommendation | null>(null),
    [error, setError] = useState<unknown>(),
    [loading, setLoading] = useState(true),
    [reload, setReload] = useState(0),
    [generation, setGeneration] = useState(0),
    [deletion, setDeletion] = useState<DeletionPreview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [deleting, setDeleting] = useState(false),
    [notice, setNotice] = useState(session.notice ?? ""),
    [assessmentDone, setAssessmentDone] = useState(false);
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
      const attempts = await request<{
        items: { status: string; stage?: string; modules: string[] }[];
      }>("/assessment-attempts", { signal: controller.signal });
      if (!controller.signal.aborted)
        setAssessmentDone(
          attempts.data.items.some(
            (item) =>
              item.status === "submitted" &&
              item.modules.some((module) => module !== "major"),
          ),
        );
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
    document.querySelector(".workspace")?.scrollTo({ top: 0 });
  }
  async function reloadSelections() {
    const value = await request<Selections>("/me/selections");
    setSelections(value);
    if (selections?.data.selectionVersion !== value.data.selectionVersion)
      research.invalidate();
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
    research.invalidate();
    setRecommendation(null);
  }
  async function changeTarget(program: Program | null) {
    if (!selections) throw new Error("选择记录尚未加载，请稍后重试。");
    const result = await request<Selections>("/me/target", {
      method: "PUT",
      etag: selections.etag,
      body: program
        ? {
            programId: program.programId,
            programRevisionId: program.programRevisionId,
          }
        : { programId: null },
    });
    setSelections(result);
    research.invalidate();
    setRecommendation(null);
    setNotice(
      program
        ? `目标已保存：${program.display.institutionName} · ${program.display.majorName}。可以继续编辑备考计划。`
        : "当前目标已取消，旧计划仍保留为历史记录。",
    );
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
      research.reset();
      interests.clear();
      clearProfileDraft(session.user!.accountId);
      setProfile(null);
      setSelections(null);
      setRecommendation(null);
      setAssessmentDone(false);
      setDeletion(null);
      setGeneration((value) => value + 1);
      setNotice(
        job.data.status === "succeeded"
          ? "个人资料及关联记录已删除。你可以重新开始。"
          : "删除作业已创建，可稍后查询完成状态。",
      );
      setReload((value) => value + 1);
      navigate("profile");
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
                navigate(id);
              }}
            >
              <Icon size={19} />
              <span>{name}</span>
              {id === "guidance" && research.badge && (
                <small
                  className="research-nav-badge"
                  aria-label="报告状态"
                  data-report-state={research.badge}
                >
                  {research.badge}
                </small>
              )}
              {id === "favorites" && (
                <small>
                  {(selections?.data.savedProgramIds.length ?? 0) +
                    interests.items.filter((item) => item.favorite).length}
                </small>
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
            <small>{session.user?.username} · 已登录</small>
          </div>
        </div>
        <AccountSecurity session={session} onSession={onSession} />
        <button className="ws-link ws-logout" onClick={onLogout}>
          <LogOut size={16} />
          退出登录
        </button>
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
          <ErrorNotice error={globalError} />
          {research.badge && page !== "guidance" && (
            <div
              className="ws-notice research-global-notice"
              role="status"
              data-report-state={research.badge}
            >
              <span>
                {research.running || research.startingMode
                  ? "报告生成中，可切换栏目，进度会保留。"
                  : `生成结束 · ${research.badge}。${research.badge === "需更新" ? "历史报告仅供回顾，请更新基础结论。" : research.failed ? "请查看原因并重试。" : "可以查看研究结果。"}`}
              </span>
              <button className="ws-link" onClick={() => navigate("guidance")}>
                查看报告
              </button>
            </div>
          )}
          {research.running && page !== "guidance" && page !== "profile" && (
            <p role="status">
              {RESEARCH_INPUT_LOCK_MESSAGE} 测评与咨询仍可使用。
            </p>
          )}

          <div className="ws-progress" aria-label="准备进度">
            <button onClick={() => navigate("profile")}>
              <span>01</span>个人画像{" "}
              <strong>
                {profile?.data.profileCompleted ||
                Number(profile?.data.profileVersion) > 0
                  ? "已保存"
                  : "待保存"}
              </strong>
            </button>
            <button onClick={() => navigate("assessment")}>
              <span>02</span>公共课测评{" "}
              <strong>{assessmentDone ? "已完成" : "可选"}</strong>
            </button>
            <button onClick={() => navigate("guidance")}>
              <span>03</span>专业推荐结论 <ArrowRight size={16} />
            </button>
          </div>
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
                    onPlan={async (program) => {
                      await changeTarget(program);
                      navigate("plan");
                    }}
                    recommendation={recommendation}
                    onRecommend={setRecommendation}
                    favorites={page === "favorites"}
                  />
                )}
                {page === "profile" && (
                  <ProfilePanel
                    accountId={session.user!.accountId}
                    resource={profile}
                    onSaved={(value) => {
                      setProfile(value);
                      research.invalidate();
                      setRecommendation(null);
                      setNotice(
                        "个人画像已保存到账号。接下来可完成公共课测评，再查看专业推荐结论。",
                      );
                      navigate("assessment");
                    }}
                    onReload={() => {
                      void request<ProfileResource>("/me/profile")
                        .then((value) => {
                          clearProfileDraft(session.user!.accountId);
                          setProfile(value);
                          if (
                            profile.data.profileVersion !==
                            value.data.profileVersion
                          )
                            research.invalidate();
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
                    onCompleted={(diagnosis) => {
                      setAssessmentDone(true);
                      const references = research.run
                        ? [
                            ...research.run.versions.assessmentRefs,
                            ...research.run.assessmentSummary.ignored,
                          ]
                        : [];
                      if (
                        diagnosis.modules.some(
                          (item) => item.module !== "major",
                        ) &&
                        !references.some(
                          (item) =>
                            item.assessmentAttemptId ===
                              diagnosis.assessmentAttemptId &&
                            item.diagnosisVersion ===
                              diagnosis.diagnosisVersion,
                        )
                      )
                        research.invalidate();
                    }}
                  />
                )}
                {page === "assessment" && (
                  <div className="ws-panel ws-between">
                    <div>
                      <h2>
                        {assessmentDone
                          ? "测评已完成，看看适合探索的专业"
                          : "可以先探索，再补充测评"}
                      </h2>
                      <p>
                        推荐会结合已保存画像与有效的公共课诊断，说明依据与待确认条件。
                      </p>
                    </div>
                    <button
                      className="ws-primary"
                      onClick={() => navigate("guidance")}
                    >
                      查看专业推荐结论
                    </button>
                  </div>
                )}
                {page === "guidance" && (
                  <GuidancePanel
                    profile={profile.data}
                    selections={selections.data}
                    onExplore={() => navigate("explore")}
                    onProfile={() => navigate("profile")}
                    onSelection={changeSelections}
                  />
                )}
                {page === "plan" && (
                  <PlanPanel
                    key={selections.data.targetProgramId ?? "no-target"}
                    programs={catalog.items ?? catalog.programs ?? []}
                    selections={selections.data}
                    recommendation={recommendation}
                    onSelectionsChanged={reloadSelections}
                    onTargetChange={changeTarget}
                  />
                )}
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
      <Suspense fallback={null}>
        <FloatingAssistant key={generation} />
      </Suspense>
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
