import { NavLink } from "react-router-dom";

const items = [
  { to: "/my-groups", icon: "groups", label: "My Groups" },
  { to: "/wallet", icon: "account_balance_wallet", label: "Wallet" },
  { to: "/applications", icon: "description", label: "Apps" },
  { to: "/settlements", icon: "emoji_events", label: "Settle" },
  { to: "/settings", icon: "settings", label: "Settings" }
];

export function MobileBottomNav() {
  return (
    <nav className="fixed bottom-0 left-0 z-20 flex w-full items-center justify-around border-t border-primary/10 bg-background-dark px-2 py-2 lg:hidden">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) =>
            `flex min-w-[60px] flex-col items-center gap-0.5 text-[11px] ${
              isActive ? "text-primary" : "text-slate-400"
            }`
          }
        >
          <span className="material-icons text-lg">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
