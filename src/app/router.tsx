import { useMemo } from "react";
import {
  Link,
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useLocation
} from "react-router-dom";
import { useAuth } from "./AuthContext";
import { AppShell } from "../components/AppShell";
import { GroupSetupPage } from "../pages/GroupSetupPage";
import { MembersPage } from "../pages/MembersPage";
import { MyGroupPage } from "../pages/MyGroupPage";
import { MyGroupsCreatePage } from "../pages/MyGroupsCreatePage";
import { MyGroupsJoinPage } from "../pages/MyGroupsJoinPage";
import { useMyGroupsList, usePendingInvites } from "../hooks/useAppQueries";
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
    return <Navigate to="/my-groups" replace />;
  }

  return <Outlet />;
}

function RootRedirect() {
  const { session, loading } = useAuth();
  if (loading) {
    return <p className="p-6 text-sm text-slate-400">Loading app...</p>;
  }
  return <Navigate to={session ? "/my-groups" : "/welcome"} replace />;
}

function MyGroupsIndexPage() {
  const groupsQuery = useMyGroupsList();
  const pendingInvitesQuery = usePendingInvites();

  if (groupsQuery.isLoading) {
    return <p className="p-6 text-sm text-slate-400">Loading groups...</p>;
  }

  const firstGroup = groupsQuery.data?.[0];
  if (!firstGroup) {
    const pendingInviteCount = pendingInvitesQuery.data?.length ?? 0;
    const recoverableNotFound =
      groupsQuery.error instanceof Error &&
      groupsQuery.error.message.toLowerCase().includes("status 404");

    if (groupsQuery.error && !recoverableNotFound) {
      return (
        <section className="rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
          <p className="text-sm text-red-300">
            {groupsQuery.error.message || "Unable to load your groups right now."}
          </p>
        </section>
      );
    }

    return (
      <section className="space-y-4 rounded-2xl border border-primary/20 bg-[#162e25] p-6">
        <h2 className="text-2xl font-black text-white">You are not part of any groups yet.</h2>
        <p className="text-sm text-[#92c9b7]">
          Create a group, accept an invitation, or join with a valid invite code.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/my-groups/create"
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-background-dark"
          >
            Create Group
          </Link>
          <Link
            to="/my-groups/join"
            className="rounded-lg border border-primary/30 px-5 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-primary/10"
          >
            Join Group{pendingInviteCount > 0 ? ` (${pendingInviteCount})` : ""}
          </Link>
        </div>
      </section>
    );
  }

  return <Navigate to={`/my-groups/${firstGroup.id}`} replace />;
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
              path: "/my-groups",
              element: <MyGroupsIndexPage />
            },
            {
              path: "/my-groups/create",
              element: <MyGroupsCreatePage />
            },
            {
              path: "/my-groups/join",
              element: <MyGroupsJoinPage />
            },
            {
              path: "/my-groups/:groupId",
              element: <MyGroupPage />
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
              path: "/applications",
              element: <MembersPage />
            },
            {
              path: "/dashboard",
              element: <Navigate to="/my-groups" replace />
            },
            {
              path: "/members",
              element: <Navigate to="/applications" replace />
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
