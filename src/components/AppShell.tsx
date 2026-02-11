import { Outlet } from "react-router-dom";
import { MobileBottomNav } from "./MobileBottomNav";
import { Sidebar } from "./Sidebar";
import { TopNav } from "./TopNav";

export function AppShell() {
  return (
    <div className="min-h-screen bg-background-dark text-slate-100">
      <div className="flex">
        <Sidebar />
        <div className="min-w-0 flex-1 lg:ml-0">
          <TopNav />
          <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 sm:px-6 lg:px-8">
            <Outlet />
          </main>
        </div>
      </div>
      <MobileBottomNav />
    </div>
  );
}
