import { useMemo } from "react";
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AppShell } from "../components/AppShell";
import { DashboardPage } from "../pages/DashboardPage";
import { GroupSetupPage } from "../pages/GroupSetupPage";
import { MembersPage } from "../pages/MembersPage";
import { SettlementsPage } from "../pages/SettlementsPage";
import { SettingsPage } from "../pages/SettingsPage";
import { WalletPage } from "../pages/WalletPage";
import { WelcomePage } from "../pages/WelcomePage";

function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <p className="p-6 text-sm text-slate-400">Checking session...</p>;
  }

  if (!session) {
    return <Navigate to="/welcome" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}

function PublicOnlyRoute() {
  const { session, loading } = useAuth();

  if (loading) {
    return <p className="p-6 text-sm text-slate-400">Checking session...</p>;
  }

  if (session) {
    return <Navigate to="/dashboard" replace />;
  }

  return <Outlet />;
}

function RootRedirect() {
  const { session, loading } = useAuth();
  if (loading) {
    return <p className="p-6 text-sm text-slate-400">Loading app...</p>;
  }
  return <Navigate to={session ? "/dashboard" : "/welcome"} replace />;
}

function LegacyAuthRedirect({ mode }: { mode: "signup" | "login" }) {
  const location = useLocation();
  const params = new URLSearchParams(location.search);

  if (mode === "login") {
    params.set("mode", "login");
  } else {
    params.delete("mode");
  }

  const query = params.toString();
  const destination = query.length ? `/welcome?${query}` : "/welcome";
  return <Navigate to={destination} replace state={location.state} />;
}

function createAppRouter() {
  return createBrowserRouter([
    {
      path: "/",
      element: <RootRedirect />
    },
    {
      element: <PublicOnlyRoute />,
      children: [
        {
          path: "/welcome",
          element: <WelcomePage />
        },
        {
          path: "/auth/login",
          element: <LegacyAuthRedirect mode="login" />
        },
        {
          path: "/auth/register",
          element: <LegacyAuthRedirect mode="signup" />
        }
      ]
    },
    {
      element: <ProtectedRoute />,
      children: [
        {
          element: <AppShell />,
          children: [
            {
              path: "/dashboard",
              element: <DashboardPage />
            },
            {
              path: "/group/setup",
              element: <GroupSetupPage />
            },
            {
              path: "/wallet",
              element: <WalletPage />
            },
            {
              path: "/settings",
              element: <SettingsPage />
            },
            {
              path: "/members",
              element: <MembersPage />
            },
            {
              path: "/settlements",
              element: <SettlementsPage />
            }
          ]
        }
      ]
    },
    {
      path: "*",
      element: <Navigate to="/" replace />
    }
  ]);
}

export function AppRouter() {
  const router = useMemo(() => createAppRouter(), []);
  return <RouterProvider router={router} />;
}
