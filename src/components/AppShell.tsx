import { Outlet, useLocation } from "react-router-dom";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

export function AppShell() {
  const location = useLocation();
  const noScrollMyGroupsPage =
    location.pathname === "/my-groups/create" || location.pathname === "/my-groups/join";
  const walletPage = location.pathname === "/wallet";
  const applicationsPage = location.pathname === "/applications";

  const mainClassName = noScrollMyGroupsPage
    ? "pb-24 pt-4 lg:h-[calc(100dvh-5rem)] lg:overflow-hidden lg:pb-4"
    : walletPage
      ? "pb-24 pt-4 lg:h-[calc(100dvh-5rem)] lg:overflow-hidden lg:pb-4"
      : applicationsPage
        ? "h-[calc(100dvh-5rem)] overflow-hidden pb-24 pt-4 lg:pb-4"
      : "pb-24 pt-6";

  return (
    <div className="min-h-screen bg-background-dark text-slate-100">
      <Sidebar />
      <div className="min-w-0 lg:pl-64">
        <TopNav />
        <main className={`mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 ${mainClassName}`}>
          <Outlet />
        </main>
      </div>
      <MobileBottomNav />
    </div>
  );
}
