import { describe, expect, it } from "vitest";
import { services } from "../services/mock/mockServices";

describe("mock services", () => {
  it("supports google and password sign in", async () => {
    const byPassword = await services.authService.loginWithPassword(
      "alex@incentapply.dev",
      "password123"
    );
    expect(byPassword.provider).toBe("password");

    const byGoogle = await services.authService.loginWithGoogle("alex@incentapply.dev");
    expect(byGoogle.provider).toBe("google");
  });

  it("validates withdrawal limits", async () => {
    await services.authService.loginWithPassword("alex@incentapply.dev", "password123");
    const wallet = await services.walletService.getWallet();
    const bankId = wallet.bankAccounts[0]?.id;
    expect(bankId).toBeDefined();

    await expect(
      services.walletService.withdraw({ amountCents: wallet.availableBalanceCents + 1, bankAccountId: bankId! })
    ).rejects.toThrow(/Insufficient wallet balance/i);
  });

  it("updates wallet ledger when settlement simulation runs", async () => {
    await services.authService.loginWithPassword("alex@incentapply.dev", "password123");
    const before = await services.walletService.getWallet();

    const result = await services.settlementService.simulateSettlementNow();
    const after = await services.walletService.getWallet();

    expect(result.breakdowns.length).toBeGreaterThan(0);
    expect(after.transactions.length).toBeGreaterThan(before.transactions.length);
  });

  it("supports manual log create/update/delete lifecycle", async () => {
    await services.authService.loginWithPassword("alex@incentapply.dev", "password123");
    const week = await services.applicationService.getCurrentWeekWindow();

    const created = await services.applicationService.createManualLog({
      company: "Linear",
      roleTitle: "Frontend Engineer",
      note: "Referral route"
    });
    expect(created.company).toBe("Linear");

    const updated = await services.applicationService.updateManualLog(created.id, {
      company: "Linear",
      roleTitle: "Product Engineer",
      note: "Updated role"
    });
    expect(updated.roleTitle).toBe("Product Engineer");

    await services.applicationService.deleteLog(created.id);
    const logs = await services.applicationService.getLogsForWeek(week.weekId);
    expect(logs.some((log) => log.id === created.id)).toBe(false);
  });

  it("creates immutable counter application logs when member count increases", async () => {
    await services.authService.loginWithPassword("alex@incentapply.dev", "password123");
    const before = await services.applicationService.getCounterApplicationLogs();

    const updated = await services.groupService.updateMemberApplicationCount({
      groupId: "group-1",
      memberId: "user-alex",
      delta: 1
    });

    const after = await services.applicationService.getCounterApplicationLogs();
    expect(after.length).toBe(before.length + 1);
    expect(after[0]?.groupId).toBe("group-1");
    expect(after[0]?.applicationIndex).toBe(updated.applicationsCount);
    expect(after[0]?.applicationGoal).toBeGreaterThan(0);
  });

  it("removes the most recent counter application log when member count decreases", async () => {
    await services.authService.loginWithPassword("alex@incentapply.dev", "password123");

    await services.groupService.updateMemberApplicationCount({
      groupId: "group-1",
      memberId: "user-alex",
      delta: 1
    });
    const afterIncrease = await services.applicationService.getCounterApplicationLogs();
    const newestAddedId = afterIncrease[0]?.id;
    expect(newestAddedId).toBeDefined();

    await services.groupService.updateMemberApplicationCount({
      groupId: "group-1",
      memberId: "user-alex",
      delta: -1
    });
    const afterDecrease = await services.applicationService.getCounterApplicationLogs();
    expect(afterDecrease.some((entry) => entry.id === newestAddedId)).toBe(false);
  });

  it("creates a new account when a first-time user logs in with Google", async () => {
    const uniqueEmail = `first.timer.${Date.now()}@incentapply.dev`;
    const session = await services.authService.loginWithGoogle(uniqueEmail);
    expect(session.provider).toBe("google");

    const user = await services.authService.getCurrentUser();
    expect(user?.email).toBe(uniqueEmail);
  });

  it("treats duplicate Google signup attempts as Google sign in", async () => {
    const session = await services.authService.registerWithGoogle("alex@incentapply.dev");
    expect(session.provider).toBe("google");

    const user = await services.authService.getCurrentUser();
    expect(user?.email).toBe("alex@incentapply.dev");
  });
});
