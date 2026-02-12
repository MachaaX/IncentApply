import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJoinGroup } from "../hooks/useAppQueries";

interface MockInvite {
  id: string;
  invitedBy: string;
  groupName: string;
  goalApps: number;
  weeklyStakeUsd: number;
  groupId: string;
}

const initialMockInvites: MockInvite[] = [
  {
    id: "invite-1",
    invitedBy: "Sarah M",
    groupName: "Growth Hunters",
    goalApps: 20,
    weeklyStakeUsd: 15,
    groupId: "group-1"
  },
  {
    id: "invite-2",
    invitedBy: "Marcus J",
    groupName: "Offer Sprint Squad",
    goalApps: 30,
    weeklyStakeUsd: 25,
    groupId: "group-2"
  },
  {
    id: "invite-3",
    invitedBy: "Elena R",
    groupName: "Frontend Strike Team",
    goalApps: 15,
    weeklyStakeUsd: 10,
    groupId: "group-3"
  },
  {
    id: "invite-4",
    invitedBy: "David K",
    groupName: "Backend Grind Crew",
    goalApps: 25,
    weeklyStakeUsd: 20,
    groupId: "group-3"
  }
];

export function MyGroupsJoinPage() {
  const navigate = useNavigate();
  const joinGroup = useJoinGroup();
  const [inviteCode, setInviteCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [invites, setInvites] = useState<MockInvite[]>(initialMockInvites);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);

    if (!inviteCode.trim()) {
      setStatus("Enter an invite code first.");
      return;
    }

    try {
      const joined = await joinGroup.mutateAsync(inviteCode.trim());
      setStatus("Invite code verified. Redirecting to your group...");
      navigate(`/my-groups/${joined.id}`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "Unable to join group.");
    }
  };

  const rejectInvite = (inviteId: string) => {
    setInvites((current) => current.filter((invite) => invite.id !== inviteId));
    setStatus("Invitation rejected.");
  };

  const acceptInvite = (inviteId: string, groupId: string) => {
    setInvites((current) => current.filter((invite) => invite.id !== inviteId));
    setStatus("Invitation accepted. Redirecting to group...");
    navigate(`/my-groups/${groupId}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden">
      <section className="w-full rounded-xl border border-dashed border-[#326755] bg-[#11221c] p-6 sm:p-7">
        <form
          onSubmit={submit}
          className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center"
        >
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#162e26] text-[#92c9b7]">
              <span className="material-icons">diversity_3</span>
            </div>
            <div>
              <h2 className="text-3xl font-black text-white">Have an invite code?</h2>
              <p className="text-sm text-[#64877a]">Join an existing squad instantly.</p>
            </div>
          </div>

          <div className="flex w-full gap-2 sm:w-auto">
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              placeholder="Enter Code (e.g SQ-882)"
              className="w-full rounded-lg border border-[#23483c] bg-[#10221c] px-4 py-2.5 text-white placeholder:text-[#4a6b5d] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary sm:w-64"
            />
            <button
              type="submit"
              disabled={joinGroup.isPending}
              className="whitespace-nowrap rounded-lg border border-primary/30 bg-[#162e26] px-5 py-2.5 text-sm font-bold text-primary transition-colors hover:bg-[#1f4236] disabled:opacity-70"
            >
              {joinGroup.isPending ? "Joining..." : "Join Squad"}
            </button>
          </div>
        </form>
        {status ? <p className="mt-3 text-sm text-primary">{status}</p> : null}
      </section>

      <section className="min-h-0 flex flex-1 flex-col overflow-hidden rounded-xl border border-border-dark bg-surface-dark p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Pending Invitations</h3>
          <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            {invites.length} invites
          </span>
        </div>

        {invites.length ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <ul className="space-y-3">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="rounded-xl border border-primary/15 bg-[#11221c] p-4 shadow-[0_8px_24px_0_rgba(0,0,0,0.25)]"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                      <p className="text-sm text-[#92c9b7]">
                        Invited by <span className="font-semibold text-white">{invite.invitedBy}</span>
                      </p>
                      <p className="text-lg font-bold text-white">{invite.groupName}</p>
                      <p className="text-sm text-[#64877a]">
                        Goal: <span className="text-[#92c9b7]">{invite.goalApps} apps/week</span> ·
                        Stake: <span className="text-[#92c9b7]">${invite.weeklyStakeUsd}/week</span>
                      </p>
                    </div>

                    <div className="flex gap-2 self-start sm:self-center">
                      <button
                        type="button"
                        onClick={() => rejectInvite(invite.id)}
                        className="rounded-lg border border-[#3b5550] bg-[#182c27] px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-300 transition-colors hover:text-white"
                      >
                        Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => acceptInvite(invite.id, invite.groupId)}
                        className="rounded-lg bg-primary px-4 py-2 text-xs font-bold uppercase tracking-wide text-background-dark transition-colors hover:bg-emerald-400"
                      >
                        Accept
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-lg border border-dashed border-[#326755] bg-[#11221c] px-4">
            <p className="text-sm text-[#64877a]">No pending invites right now.</p>
          </div>
        )}
      </section>
    </div>
  );
}
