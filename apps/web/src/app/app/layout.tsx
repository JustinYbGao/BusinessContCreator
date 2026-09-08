import type { ReactNode } from "react";
import { requireServerInternalWorkspace } from "../../lib/supabase/server";
import ConsoleNav from "../../components/console-nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const context = await requireServerInternalWorkspace();

  return (
    <div className="console-shell">
      <ConsoleNav workspaceId={context.workspaceId} />
      <div className="console-main">
        <header className="console-topbar">
          <span className="console-topbar-title">内容运营工作台</span>
          <div className="console-topbar-user">
            <span>单工作区控制台</span>
          </div>
        </header>
        <div className="console-content">
          {children}
        </div>
      </div>
    </div>
  );
}
