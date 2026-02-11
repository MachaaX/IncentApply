import type { ApplicationLog, KeywordRule } from "../../domain/types";

interface MockInboundEmail {
  from: string;
  subject: string;
  company: string;
  roleTitle: string;
  receivedAt: string;
}

const companies = ["Atlassian", "Dropbox", "Canva", "Asana", "Snowflake", "Airbnb"];
const roles = [
  "Frontend Engineer",
  "Backend Engineer",
  "Product Engineer",
  "Software Engineer",
  "Full Stack Engineer"
];
const senders = [
  "careers@jobs.workday.com",
  "team@greenhouse.io",
  "notifications@lever.co",
  "updates@myworkdayjobs.com"
];
const subjects = [
  "Thank you for applying",
  "Application received",
  "Your application has been submitted",
  "Thanks for your interest"
];

function pick<T>(list: T[], index: number): T {
  return list[index % list.length];
}

export function generateInboundEmails(count: number): MockInboundEmail[] {
  const now = Date.now();
  const results: MockInboundEmail[] = [];

  for (let i = 0; i < count; i += 1) {
    results.push({
      from: pick(senders, i),
      subject: pick(subjects, i),
      company: pick(companies, i),
      roleTitle: pick(roles, i),
      receivedAt: new Date(now - i * 17 * 60 * 1000).toISOString()
    });
  }

  return results;
}

export function matchEmailToRule(
  email: MockInboundEmail,
  rules: KeywordRule[]
): KeywordRule | null {
  const normalizedFrom = email.from.toLowerCase();
  const normalizedSubject = email.subject.toLowerCase();

  for (const rule of rules) {
    if (!rule.enabled) {
      continue;
    }

    const senderMatch = rule.senderIncludes.some((sender) =>
      normalizedFrom.includes(sender.toLowerCase())
    );
    const subjectMatch = rule.subjectIncludes.some((subject) =>
      normalizedSubject.includes(subject.toLowerCase())
    );

    if (senderMatch || subjectMatch) {
      return rule;
    }
  }

  return null;
}

export function emailsToLogs(input: {
  emails: MockInboundEmail[];
  userId: string;
  groupId: string;
  existingLogIds: Set<string>;
  rules: KeywordRule[];
}): ApplicationLog[] {
  const created: ApplicationLog[] = [];

  for (const email of input.emails) {
    const rule = matchEmailToRule(email, input.rules);
    const id = `gmail-${input.userId}-${email.receivedAt}-${email.company}`;
    if (input.existingLogIds.has(id)) {
      continue;
    }

    created.push({
      id,
      userId: input.userId,
      groupId: input.groupId,
      source: "gmail",
      company: email.company,
      roleTitle: email.roleTitle,
      emailSubject: email.subject,
      emailFrom: email.from,
      timestamp: email.receivedAt,
      matchedRuleId: rule?.id,
      isCounted: Boolean(rule)
    });
  }

  return created;
}
