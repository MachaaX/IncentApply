import { NavLink } from "react-router-dom";
import { useAuth } from "../app/AuthContext";

const links = [
  { to: "/my-groups", label: "My Groups", icon: "groups" },
  { to: "/wallet", label: "Wallet", icon: "account_balance_wallet" },
  { to: "/applications", label: "Applications", icon: "description" },
  { to: "/settlements", label: "Settlements", icon: "emoji_events" },
  { to: "/settings", label: "Settings", icon: "settings" }
];

export function Sidebar() {
  const { user, signOut } = useAuth();

  return (
    <aside className="hidden h-screen w-64 flex-shrink-0 flex-col justify-between border-r border-primary/10 bg-background-dark lg:fixed lg:inset-y-0 lg:left-0 lg:z-30 lg:flex">
      <div>
        <div className="flex h-20 items-center gap-3 border-b border-primary/10 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-primary text-background-dark">
            <span className="material-icons text-lg">offline_bolt</span>
          </div>
          <span className="text-lg font-bold tracking-tight text-white">IncentApply</span>
        </div>
        <nav className="space-y-1 p-4">
          {links.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-primary/15 text-primary"
                    : "text-slate-400 hover:bg-primary/10 hover:text-white"
                }`
              }
            >
              <span className="material-icons text-base">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>

      <div className="p-4">
        <div className="rounded-xl border border-primary/15 bg-surface-dark p-4">
          <p className="text-xs text-slate-400">Signed in as</p>
          <p className="text-sm font-semibold text-white">{user?.firstName} {user?.lastName}</p>
          <p className="text-xs text-slate-500">{user?.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-3 w-full rounded-lg bg-primary/10 px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-primary/20"
        >
          Log Out
        </button>
      </div>
    </aside>
  );
}
