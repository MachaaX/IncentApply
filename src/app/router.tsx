import { useMemo } from "react";
import { Navigate, Outlet, RouterProvider, createBrowserRouter, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AppShell } from "../components/AppShell";
import { DashboardPage } from "../pages/DashboardPage";
import { GroupSetupPage } from "../pages/GroupSetupPage";
import { LoginPage } from "../pages/LoginPage";
import { MembersPage } from "../pages/MembersPage";
import { RegisterPage } from "../pages/RegisterPage";
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
          element: <LoginPage />
        },
        {
          path: "/auth/register",
          element: <RegisterPage />
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
