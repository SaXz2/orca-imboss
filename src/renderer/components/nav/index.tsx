import { SettingKeys } from "@shared/constants/settings";
import { t } from "@shared/l10n";
import type { CronJobInfo } from "@shared/types";
import { useEffect, useRef, useState } from "react";
import { cls } from "reactutils";
import { appStore, sessionKey, useApp, type AppModule } from "../../app-store";
import { employeeLabel } from "../../employee-label";
import { BrandLogo } from "../brand-logo";
import { ContextMenu, type ContextMenuState } from "../context-menu";
import { EmployeeAvatar } from "../employee-avatar";
import { GroupAvatar } from "../group-avatar";
import {
  IconApp,
  IconChat,
  IconChevronDown,
  IconCollapse,
  IconEmployees,
  IconGear,
  IconMcp,
  IconSkills,
  IconTasks,
  IconUsage,
} from "../icons";
import { formatChatTime } from "../modules/chat/relative-time";
import { Tooltip } from "../tooltip";
import "./index.css";

interface NavItem {
  module: AppModule;
  labelKey: string;
  icon: (props: { className?: string }) => React.JSX.Element;
  section?: "main" | "miniapp" | "bottom";
  /** Renders an expandable browse list under the entry (what is inside). */
  browse?: "chats" | "employees";
}

const NAV_ITEMS: NavItem[] = [
  {
    module: "chat",
    labelKey: "Chats",
    icon: IconChat,
    section: "main",
    browse: "chats",
  },
  {
    module: "employees",
    labelKey: "Employees",
    icon: IconEmployees,
    section: "main",
    browse: "employees",
  },
  {
    module: "tasks",
    labelKey: "Tasks",
    icon: IconTasks,
    section: "main",
  },
  {
    module: "usage",
    labelKey: "Usage",
    icon: IconUsage,
    section: "main",
  },
  { module: "mcp", labelKey: "MCP", icon: IconMcp, section: "main" },
  {
    module: "skills",
    labelKey: "Skills",
    icon: IconSkills,
    section: "main",
  },
  {
    module: "settings",
    labelKey: "Settings",
    icon: IconGear,
    section: "bottom",
  },
];

export interface NavProps {
  collapsed: boolean;
  onToggle: () => void;
}

/** Read-only shape of an opened chat (valtio snapshots are deeply readonly). */
interface NavChat {
  readonly id: number;
  readonly title: string;
  readonly participants: readonly number[];
}

export function Nav({ collapsed, onToggle }: NavProps): React.JSX.Element {
  const {
    openedChats,
    openedSessions,
    module,
    activeChatId,
    activeSessionKey,
    activeMiniAppId,
    brandName,
    brandLogo,
    data,
  } = useApp();
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [chatDragId, setChatDragId] = useState<number | null>(null);
  const [sessionDragKey, setSessionDragKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<AppModule | null>(null);
  const [cronJobs, setCronJobs] = useState<CronJobInfo[]>([]);

  // Scheduled tasks live in the rail so automation is visible from anywhere.
  // Refreshed on a slow timer: one indexed query, and jobs change rarely.
  useEffect(() => {
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const jobs = await imb.cron.listAll();
        if (alive) setCronJobs(jobs);
      } catch {
        // Best-effort: keep the last snapshot.
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  const [brandEditing, setBrandEditing] = useState(false);
  const [brandDraft, setBrandDraft] = useState("");
  const brandLogoInputRef = useRef<HTMLInputElement>(null);

  function beginBrandEdit(): void {
    setBrandDraft(brandName);
    setBrandEditing(true);
  }

  async function commitBrandEdit(): Promise<void> {
    setBrandEditing(false);
    const next = brandDraft.trim();
    if (next !== brandName) await appStore.setBrand(next, brandLogo);
  }

  function onBrandLogoPicked(file: File | undefined): void {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : null;
      void appStore.setBrand(brandName, url);
    };
    reader.readAsDataURL(file);
  }

  const main = NAV_ITEMS.filter((i) => i.section === "main");
  const bottom = NAV_ITEMS.filter((i) => i.section === "bottom");
  const miniApps = data.miniapps.items;

  /** Move `fromId` to `toId`'s position and persist the new order. */
  function reorderMiniApps(fromId: string, toId: string): void {
    if (fromId === toId) return;
    const ids = miniApps.map((app) => app.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ...ids.splice(from, 1));
    void appStore.reorderMiniApps(ids);
  }

  return (
    <>
      <nav
        className={cls("imb-nav", collapsed && "imb-is-collapsed")}
        aria-label="Modules"
      >
        <div className="imb-nav-brand">
          <button
            type="button"
            className="imb-nav-brandavatar"
            title={t("Change avatar")}
            aria-label={t("Change avatar")}
            onClick={() => brandLogoInputRef.current?.click()}
          >
            {brandLogo ? (
              <img
                className="imb-nav-brandlogo"
                src={brandLogo}
                alt=""
                draggable={false}
              />
            ) : (
              <BrandLogo style={{ maxWidth: "41px" }} />
            )}
          </button>
          {brandEditing ? (
            <input
              className="imb-nav-brandinput"
              value={brandDraft}
              maxLength={40}
              autoFocus
              aria-label={t("App name")}
              onChange={(event) => setBrandDraft(event.target.value)}
              onBlur={() => void commitBrandEdit()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitBrandEdit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setBrandEditing(false);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="imb-nav-brandname"
              title={t("Click to rename")}
              onClick={beginBrandEdit}
            >
              {brandName || "imboss"}
            </button>
          )}
          <input
            ref={brandLogoInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(event) => {
              onBrandLogoPicked(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
        </div>
        <div className="imb-nav-items">
          {main.map((item) =>
            item.browse ? (
              <NavBrowseGroup
                key={item.module}
                item={item}
                collapsed={collapsed}
                expanded={expanded === item.module}
                onToggle={() =>
                  setExpanded((current) =>
                    current === item.module ? null : item.module,
                  )
                }
              />
            ) : (
              <NavButton key={item.module} item={item} collapsed={collapsed} />
            ),
          )}
        </div>
        <div className="imb-nav-divider" />
        <div className="imb-scroll">
          {miniApps.length > 0 && (
            <div className="imb-nav-group">
              <div className="imb-nav-section">{t("Apps")}</div>
              <div className="imb-nav-items">
                {miniApps.map((app) => (
                  <NavMiniAppButton
                    key={app.id}
                    app={app}
                    collapsed={collapsed}
                    active={module === "miniapp" && activeMiniAppId === app.id}
                    dragging={dragId === app.id}
                    onClick={() => appStore.openMiniApp(app.id)}
                    onDragStart={() => setDragId(app.id)}
                    onDragEnd={() => setDragId(null)}
                    onDrop={() => {
                      if (dragId) reorderMiniApps(dragId, app.id);
                      setDragId(null);
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {cronJobs.length > 0 && (
            <div className="imb-nav-group">
              <div className="imb-nav-section">{t("Scheduled tasks")}</div>
              <div className="imb-nav-items">
                {cronJobs.map((job) => {
                  const employee = data.employees.items.find(
                    (person) => person.id === job.employeeId,
                  );
                  return (
                    <NavCronButton
                      key={job.id}
                      job={job}
                      label={
                        employee ? employeeLabel(employee) : `#${job.employeeId}`
                      }
                      collapsed={collapsed}
                      onClick={() =>
                        void appStore.openAgentSession(
                          job.employeeId,
                          job.chatId,
                        )
                      }
                    />
                  );
                })}
              </div>
            </div>
          )}
          {openedChats.length > 0 && (
            <div className="imb-nav-group">
              <div className="imb-nav-section">{t("Chats")}</div>
              <div className="imb-nav-items">
                {openedChats.map((chat) => (
                  <NavChatButton
                    key={chat.id}
                    chat={chat}
                    collapsed={collapsed}
                    active={module === "group-chat" && activeChatId === chat.id}
                    dragging={chatDragId === chat.id}
                    onClick={() => appStore.activateChat(chat.id)}
                    onDragStart={() => setChatDragId(chat.id)}
                    onDragEnd={() => setChatDragId(null)}
                    onDrop={() => {
                      if (chatDragId !== null) {
                        appStore.reorderOpenedChats(chatDragId, chat.id);
                      }
                      setChatDragId(null);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCtxMenu({
                        x: e.clientX,
                        y: e.clientY,
                        items: [
                          {
                            key: "close",
                            label: t("Close"),
                            onSelect: () => appStore.closeChat(chat.id),
                          },
                        ],
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          )}
          {openedSessions.length > 0 && (
            <div className="imb-nav-group">
              <div className="imb-nav-section">{t("Sessions")}</div>
              <div className="imb-nav-items">
                {openedSessions.map((session) => {
                  const key = sessionKey(session.employeeId, session.chatId);
                  const employee = data.employees.items.find(
                    (e) => e.id === session.employeeId,
                  );
                  const name = employee?.name ?? t("Unnamed");
                  return (
                    <NavSessionButton
                      key={key}
                      employeeId={session.employeeId}
                      label={name}
                      sub={session.chatTitle}
                      collapsed={collapsed}
                      active={
                        module === "agent-session" && activeSessionKey === key
                      }
                      dragging={sessionDragKey === key}
                      onClick={() => appStore.activateSession(key)}
                      onDragStart={() => setSessionDragKey(key)}
                      onDragEnd={() => setSessionDragKey(null)}
                      onDrop={() => {
                        if (sessionDragKey !== null) {
                          appStore.reorderOpenedSessions(sessionDragKey, key);
                        }
                        setSessionDragKey(null);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setCtxMenu({
                          x: e.clientX,
                          y: e.clientY,
                          items: [
                            {
                              key: "close",
                              label: t("Close"),
                              onSelect: () => appStore.closeSession(key),
                            },
                          ],
                        });
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div className="imb-nav-spacer" />
        <div className="imb-nav-items imb-nav-bottom">
          <Tooltip
            content={collapsed ? t("Expand") : t("Collapse")}
            placement="right"
            disabled={!collapsed}
          >
            <button
              type="button"
              className="imb-nav-toggle"
              aria-label={collapsed ? t("Expand") : t("Collapse")}
              onClick={onToggle}
            >
              <IconCollapse className="imb-icon" />
              <span>{t("Collapse")}</span>
            </button>
          </Tooltip>
          {bottom.map((item) => (
            <NavButton key={item.module} item={item} collapsed={collapsed} />
          ))}
        </div>
      </nav>
      <ContextMenu state={ctxMenu} onClose={() => setCtxMenu(null)} />
    </>
  );
}

type NavBrowseGroupProps = {
  item: NavItem;
  collapsed: boolean;
  expanded: boolean;
  onToggle: () => void;
};

/** How many rows a browse group shows before you open the module itself. */
const BROWSE_LIMIT = 6;

/**
 * A module entry that can be opened up to browse what is inside it — recent
 * conversations or the employee roster — so the sidebar browses content instead
 * of only switching modules.
 */
function NavBrowseGroup({
  item,
  collapsed,
  expanded,
  onToggle,
}: NavBrowseGroupProps): React.JSX.Element {
  const { module, locale, data } = useApp();
  const Icon = item.icon;
  const active = module === item.module;

  // Chat summaries load lazily (the chat module normally owns that fetch).
  useEffect(() => {
    if (expanded && item.browse === "chats" && !data.chats.loaded) {
      void appStore.loadChats();
    }
  }, [expanded, item.browse, data.chats.loaded]);

  async function setModule(value: AppModule): Promise<void> {
    appStore.module = value;
    await imb.settings.set(SettingKeys.Module, value);
  }

  const chats = data.chats.items.slice(0, BROWSE_LIMIT);
  const employees = data.employees.items.slice(0, BROWSE_LIMIT);
  const open = expanded && !collapsed;

  return (
    <div className={cls("imb-nav-browse", open && "imb-is-open")}>
      <div className="imb-nav-browse-head">
        <Tooltip
          content={t(item.labelKey)}
          placement="right"
          disabled={!collapsed}
        >
          <button
            type="button"
            className={cls("imb-nav-item", active && "imb-is-active")}
            aria-current={active ? "page" : undefined}
            aria-label={collapsed ? t(item.labelKey) : undefined}
            onClick={() => void setModule(item.module)}
          >
            <Icon className="imb-icon" />
            <span className="imb-nav-label">{t(item.labelKey)}</span>
          </button>
        </Tooltip>
        {!collapsed && (
          <button
            type="button"
            className="imb-nav-browse-toggle"
            aria-expanded={expanded}
            aria-label={t("Browse")}
            onClick={onToggle}
          >
            <IconChevronDown className="imb-icon imb-xs" />
          </button>
        )}
      </div>

      {open && (
        <div className="imb-nav-browse-list">
          {item.browse === "chats"
            ? chats.map((chat) => (
                <button
                  key={`chat:${chat.id}`}
                  type="button"
                  className="imb-nav-browse-item"
                  onClick={() => void appStore.focusChat(chat.id)}
                >
                  <span className="imb-nav-browse-icon">
                    <IconChat />
                  </span>
                  <span className="imb-nav-browse-text">
                    <span className="imb-nav-label">
                      {chat.title || t("Untitled")}
                    </span>
                    <span className="imb-nav-sub">
                      {formatChatTime(chat.lastAt, locale)}
                    </span>
                  </span>
                </button>
              ))
            : employees.map((employee) => (
                <button
                  key={`employee:${employee.id}`}
                  type="button"
                  className="imb-nav-browse-item"
                  onClick={() => void appStore.focusEmployee(employee.id)}
                >
                  <EmployeeAvatar employeeId={employee.id} size={18} />
                  <span className="imb-nav-browse-text">
                    <span className="imb-nav-label">
                      {employeeLabel(employee)}
                    </span>
                    <span className="imb-nav-sub">
                      {employee.role || `#${employee.id}`}
                    </span>
                  </span>
                </button>
              ))}
        </div>
      )}
    </div>
  );
}

type NavButtonProps = {
  item: NavItem;
  collapsed: boolean;
};

function NavButton({ item, collapsed }: NavButtonProps): React.JSX.Element {
  const { module } = useApp();

  async function setModule(value: AppModule): Promise<void> {
    // Entering Settings via the nav opens its default section; the updater's
    // notification click deep-links to About through `appStore.openSettings`.
    if (value === "settings") appStore.settingsSection = "general";
    appStore.module = value;
    await imb.settings.set(SettingKeys.Module, value);
  }

  const Icon = item.icon;
  const active = module === item.module;

  return (
    <Tooltip content={t(item.labelKey)} placement="right" disabled={!collapsed}>
      <button
        type="button"
        className={cls("imb-nav-item", active && "imb-is-active")}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? t(item.labelKey) : undefined}
        onClick={() => setModule(item.module)}
      >
        <Icon className="imb-icon" />
        <span className="imb-nav-label">{t(item.labelKey)}</span>
      </button>
    </Tooltip>
  );
}

type NavCronButtonProps = {
  job: CronJobInfo;
  label: string;
  collapsed: boolean;
  onClick: () => void;
};

/** Nav entry for one scheduled task: who runs it, when, and what it does. */
function NavCronButton({
  job,
  label,
  collapsed,
  onClick,
}: NavCronButtonProps): React.JSX.Element {
  const preview = job.content.replace(/\s+/g, " ").trim();
  return (
    <Tooltip content={preview} placement="right">
      <button
        type="button"
        className="imb-nav-item"
        aria-label={collapsed ? label : undefined}
        onClick={onClick}
      >
        <EmployeeAvatar employeeId={job.employeeId} size={24} />
        <span className="imb-nav-text">
          <span className="imb-nav-label">{label}</span>
          <span className="imb-nav-sub">
            {job.schedule}
            {preview.length > 0 ? ` · ${preview}` : ""}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

type NavChatButtonProps = {
  chat: NavChat;
  collapsed: boolean;
  active: boolean;
  dragging: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
};

/** Nav entry for a group chat opened from a `chat`-kind card. */
function NavChatButton({
  chat,
  collapsed,
  active,
  dragging,
  onClick,
  onDragStart,
  onDragEnd,
  onDrop,
  onContextMenu,
}: NavChatButtonProps): React.JSX.Element {
  return (
    <Tooltip content={chat.title} placement="right">
      <button
        type="button"
        className={cls(
          "imb-nav-item",
          active && "imb-is-active",
          dragging && "imb-is-dragging",
        )}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? chat.title : undefined}
        draggable
        onClick={onClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
      >
        <GroupAvatar participants={chat.participants} size={24} />
        <span className="imb-nav-text">
          <span className="imb-nav-label">{chat.title}</span>
          <span className="imb-nav-sub">
            {t("${count} members", {
              count: String(chat.participants.length),
            })}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

/** Nav entry for an opened employee agent session. */
function NavSessionButton({
  employeeId,
  label,
  sub,
  collapsed,
  active,
  dragging,
  onClick,
  onDragStart,
  onDragEnd,
  onDrop,
  onContextMenu,
}: NavSessionButtonProps): React.JSX.Element {
  return (
    <Tooltip content={label} placement="right">
      <button
        type="button"
        className={cls(
          "imb-nav-item",
          active && "imb-is-active",
          dragging && "imb-is-dragging",
        )}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        draggable
        onClick={onClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
        onContextMenu={onContextMenu}
      >
        <EmployeeAvatar employeeId={employeeId} size={24} />
        <span className="imb-nav-text">
          <span className="imb-nav-label">{label}</span>
          {sub && <span className="imb-nav-sub">{sub}</span>}
        </span>
      </button>
    </Tooltip>
  );
}

type NavSessionButtonProps = {
  employeeId: number;
  label: string;
  sub?: string;
  collapsed: boolean;
  active: boolean;
  dragging: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onContextMenu: (event: React.MouseEvent) => void;
};

/** Read-only shape of a registered mini app (valtio snapshots are readonly). */
interface NavMiniApp {
  readonly id: string;
  readonly name: string;
  readonly iconUrl: string | null;
}

type NavMiniAppButtonProps = {
  app: NavMiniApp;
  collapsed: boolean;
  active: boolean;
  dragging: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
};

/** Nav entry for a registered mini app; draggable to reorder the sidebar. */
function NavMiniAppButton({
  app,
  collapsed,
  active,
  dragging,
  onClick,
  onDragStart,
  onDragEnd,
  onDrop,
}: NavMiniAppButtonProps): React.JSX.Element {
  return (
    <Tooltip content={app.name} placement="right">
      <button
        type="button"
        className={cls(
          "imb-nav-item",
          active && "imb-is-active",
          dragging && "imb-is-dragging",
        )}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? app.name : undefined}
        draggable
        onClick={onClick}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        {app.iconUrl !== null ? (
          <img
            className="imb-nav-appicon"
            src={app.iconUrl}
            alt=""
            draggable={false}
          />
        ) : (
          <IconApp className="imb-icon" />
        )}
        <span className="imb-nav-label">{app.name}</span>
      </button>
    </Tooltip>
  );
}
