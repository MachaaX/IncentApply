import { Outlet, useLocation } from "react-router-dom";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

export function AppShell() {
  const location = useLocation();
  const noScrollMyGroupsPage =
    location.pathname === "/my-groups/create" || location.pathname === "/my-groups/join";

  return (
    <div className="min-h-screen bg-background-dark text-slate-100">
      <Sidebar />
      <div className="min-w-0 lg:pl-64">
        <TopNav />
        <main
          className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${
            noScrollMyGroupsPage
              ? "h-[calc(100dvh-5rem)] overflow-hidden pb-4 pt-4"
              : "pb-24 pt-6"
          }`}
        >
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
