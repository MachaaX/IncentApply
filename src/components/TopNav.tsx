import { useMemo } from "react";
import { useLocation } from "react-router-dom";

const routeTitle: Record<string, string> = {
  "/dashboard": "Group Dashboard",
  "/group/setup": "Group Setup",
  "/wallet": "My Wallet",
  "/members": "Members",
  "/settlements": "Settlements",
  "/settings": "Settings"
};

export function TopNav() {
  const location = useLocation();

  const title = useMemo(() => {
    return routeTitle[location.pathname] ?? "IncentApply";
  }, [location.pathname]);

  return (
    <header className="sticky top-0 z-10 flex h-20 items-center justify-between border-b border-primary/10 bg-background-dark/85 px-6 backdrop-blur-md">
      <div>
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <p className="text-xs text-slate-400">Friday to Friday challenge cycle</p>
      </div>
      <button
        type="button"
        className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-background-dark shadow-glow transition-colors hover:bg-primary-dark"
      >
        <span className="material-icons mr-2 align-middle text-base">add_circle</span>
        Log Application
      </button>
    </header>
  );
}
