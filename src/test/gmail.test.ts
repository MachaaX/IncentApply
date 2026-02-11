import { describe, expect, it } from "vitest";
import { emailsToLogs, matchEmailToRule } from "../mocks/scenarios/gmail";
import { createSeedState } from "../mocks/data/seed";

describe("gmail keyword matching", () => {
  it("matches configured sender and subject rules", () => {
    const state = createSeedState();
    const rule = matchEmailToRule(
      {
        from: "careers@jobs.workday.com",
        subject: "Thank you for applying",
        company: "Acme",
        roleTitle: "Engineer",
        receivedAt: new Date().toISOString()
      },
      state.platformConfig.keywordRules
    );

    expect(rule?.id).toBe("rule-workday");
  });

  it("does not create duplicate logs when ids already exist", () => {
    const state = createSeedState();
    const email = {
      from: "careers@jobs.workday.com",
      subject: "Application received",
      company: "Acme",
      roleTitle: "Engineer",
      receivedAt: "2026-02-10T10:00:00.000Z"
    };

    const existing = new Set([`gmail-user-alex-${email.receivedAt}-${email.company}`]);

    const logs = emailsToLogs({
      emails: [email],
      userId: "user-alex",
      groupId: "group-1",
      existingLogIds: existing,
      rules: state.platformConfig.keywordRules
    });

    expect(logs).toHaveLength(0);
  });
});
