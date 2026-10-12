import { useEffect, useState } from "react";
import { parseSessionKey, useApp, type AppModule } from "./app-store";
import { AppShell } from "./components/app-shell";
import { AgentSessionModule } from "./components/modules/agent-session/agent-session-module";
import { ChatModule } from "./components/modules/chat/chat-module";
import { EmployeesModule } from "./components/modules/employees/employees-module";
import { GroupChatModule } from "./components/modules/group-chat/group-chat-module";
import { McpModule } from "./components/modules/mcp/mcp-module";
import { MiniAppModule } from "./components/modules/miniapp/miniapp-module";
import { RightDock, RightDockHandle } from "./components/right-dock";
import { SettingsModule } from "./components/modules/settings/settings-module";
import { SkillsModule } from "./components/modules/skills/skills-module";
import { TasksModule } from "./components/modules/tasks/tasks-module";
import { UsageModule } from "./components/modules/usage/usage-module";

const MODULE_VIEWS: Partial<Record<AppModule, () => React.JSX.Element>> = {
  chat: ChatModule,
  tasks: TasksModule,
  usage: UsageModule,
  mcp: McpModule,
  skills: SkillsModule,
  employees: EmployeesModule,
  settings: SettingsModule,
};

export default function App(): React.JSX.Element {
  // Subscribe to `locale` so that a language switch re-renders the whole tree
  // and every `t()` call re-evaluates against the new locale. Without this,
  // only components that read `locale` directly (e.g. SettingsGeneral) refresh;
  // the rest of the UI (nav, headers, modules) would wait for a restart.
  const { locale } = useApp();
  const [dockOpen, setDockOpen] = useState(false);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <>
      <AppShell />
      <ActiveModule />
      {/* Always mounted so visited mini-app iframes survive module switches. */}
      <MiniAppModule />
      {/* The workbench dock sits beside the content, opened from the edge handle. */}
      {dockOpen ? (
        <RightDock open onClose={() => setDockOpen(false)} />
      ) : (
        <RightDockHandle onOpen={() => setDockOpen(true)} />
      )}
    </>
  );
}

function ActiveModule(): React.JSX.Element {
  const { module, activeChatId, activeSessionKey } = useApp();

  // Group chats opened from `chat`-kind cards render in a dedicated
  // single-pane view; the key resets the view when switching chats.
  if (module === "group-chat" && activeChatId !== null) {
    return <GroupChatModule key={activeChatId} chatId={activeChatId} />;
  }

  // Agent sessions opened from a chat avatar render in a dedicated single-pane
  // view; the key resets the view (and its live binding) when switching.
  if (module === "agent-session" && activeSessionKey !== null) {
    const target = parseSessionKey(activeSessionKey);
    if (target) {
      return (
        <AgentSessionModule
          key={activeSessionKey}
          employeeId={target.employeeId}
          chatId={target.chatId}
        />
      );
    }
  }

  // Mini apps are rendered by the persistent `MiniAppModule` host (so their
  // pages are never unmounted); the shell still uses the `single` layout here.
  if (module === "miniapp") return <></>;

  const View = MODULE_VIEWS[module];
  if (View) return <View />;
  return <ChatModule />;
}
