import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import cors from "cors";
import express from "express";
import jwt from "jsonwebtoken";
import { Pool } from "pg";
import { newDb } from "pg-mem";
import { OAuth2Client } from "google-auth-library";
import { Algorithm, hash, verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";

function loadEnvironmentFiles() {
  const candidatePaths = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "backend/.env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), ".env.local"),
    resolve(process.cwd(), "backend/.env.local")
  ];

  for (const envPath of candidatePaths) {
    if (existsSync(envPath)) {
      loadEnv({ path: envPath, override: false });
    }
  }
}

loadEnvironmentFiles();

const app = express();
const backendDir = fileURLToPath(new URL(".", import.meta.url));
const projectRoot = resolve(backendDir, "..");
const frontendDistDir = resolve(projectRoot, "dist");
const frontendIndexFile = resolve(frontendDistDir, "index.html");

const PORT = Number(process.env.PORT ?? 4000);
const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET =
  process.env.JWT_SECRET ??
  (process.env.NODE_ENV === "production"
    ? undefined
    : "dev-only-insecure-jwt-secret-change-me");
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const ENTRA_CLIENT_ID = process.env.ENTRA_CLIENT_ID;
const ENTRA_CLIENT_SECRET = process.env.ENTRA_CLIENT_SECRET;
const ENTRA_REDIRECT_URI = process.env.ENTRA_REDIRECT_URI;
const ENTRA_DISCOVERY_URL = process.env.ENTRA_DISCOVERY_URL;
const ENTRA_SCOPES = process.env.ENTRA_SCOPES ?? "openid profile email";
const GROUP_NAME_MAX_LENGTH = 30;
const INVITE_EXPIRY_MS = 24 * 60 * 60 * 1000;
const MAX_AVATAR_DATA_URL_LENGTH = 60000;
const DEFAULT_GOAL_CYCLE = "weekly";
const ALLOWED_GOAL_CYCLES = new Set(["daily", "weekly", "biweekly"]);
const DEFAULT_GOAL_START_DAY = "monday";
const ALLOWED_GOAL_START_DAYS = new Set([
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday"
]);
const GOAL_START_DAY_TO_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6
};
const APP_TIME_ZONE = "America/New_York";
const UTC_ISO_TIMESTAMP_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
let memberCycleCountsStoreMode = "database";
const volatileMemberCycleCounts = new Map();
const entraConfiguredExplicitly = Boolean(
  ENTRA_CLIENT_ID || ENTRA_CLIENT_SECRET || ENTRA_REDIRECT_URI || ENTRA_DISCOVERY_URL
);
if (!JWT_SECRET) {
  throw new Error("Missing JWT_SECRET in environment.");
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

function memberCycleCountKey(groupId, cycleKey, userId) {
  return `${groupId}:${cycleKey}:${userId}`;
}

function buildVolatileCycleCountMap(groupId, cycleKey) {
  const prefix = `${groupId}:${cycleKey}:`;
  const counts = new Map();

  for (const [key, value] of volatileMemberCycleCounts.entries()) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const userId = key.slice(prefix.length);
    counts.set(userId, Math.max(0, Number(value ?? 0)));
  }

  return counts;
}

function setVolatileCycleCount(groupId, userId, cycleKey, applicationsCount) {
  const normalized = Math.max(0, Math.floor(Number(applicationsCount) || 0));
  volatileMemberCycleCounts.set(memberCycleCountKey(groupId, cycleKey, userId), normalized);
  return normalized;
}

function getVolatileCycleCount(groupId, userId, cycleKey) {
  return Math.max(
    0,
    Number(volatileMemberCycleCounts.get(memberCycleCountKey(groupId, cycleKey, userId)) ?? 0)
  );
}

function disablePersistentMemberCycleCounts(reason) {
  if (memberCycleCountsStoreMode === "volatile") {
    return;
  }
  memberCycleCountsStoreMode = "volatile";
  const message = reason instanceof Error ? reason.message : String(reason ?? "unknown error");
  console.warn(
    `Persistent group_member_cycle_counts disabled for this process. Falling back to in-memory counts. ${message}`
  );
}

function createInMemoryPool() {
  const db = newDb();
  const { Pool: InMemoryPool } = db.adapters.createPg();
  return new InMemoryPool();
}

function formatMySqlTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const pad = (segment) => String(segment).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(
    date.getUTCHours()
  )}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function normalizeMySqlParamValue(param) {
  if (param instanceof Date) {
    return formatMySqlTimestamp(param);
  }
  if (typeof param === "string" && UTC_ISO_TIMESTAMP_REGEX.test(param)) {
    return formatMySqlTimestamp(param);
  }
  return param;
}

function createPostgresPool(connectionString) {
  return new Pool({
    connectionString,
    ssl:
      connectionString.includes(".azure.com") || connectionString.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined
  });
}

async function createMySqlPool(connectionString) {
  let mysqlDriver;
  try {
    const mysqlModule = await import("mysql2/promise");
    mysqlDriver = mysqlModule.default ?? mysqlModule;
  } catch {
    throw new Error(
      "MySQL support requires `mysql2`. Run `npm install` and restart the backend."
    );
  }

  const parsed = new URL(connectionString);
  const host = parsed.hostname ?? "";
  const ssl =
    host.includes("azure.com") || host.includes("mysql.database.azure.com")
      ? { minVersion: "TLSv1.2", rejectUnauthorized: false }
      : undefined;

  const mysqlPool = mysqlDriver.createPool({
    uri: connectionString,
    ssl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });

  return {
    async query(sql, params = []) {
      const orderedParams = [];
      const mysqlSql = sql.replace(/\$(\d+)/g, (_, groupIndex) => {
        const zeroBasedIndex = Number(groupIndex) - 1;
        orderedParams.push(normalizeMySqlParamValue(params[zeroBasedIndex]));
        return "?";
      });
      const mysqlParams =
        orderedParams.length > 0
          ? orderedParams
          : params.map((value) => normalizeMySqlParamValue(value));
      const [rows] = await mysqlPool.query(mysqlSql, mysqlParams);

      if (Array.isArray(rows)) {
        return { rows };
      }

      return {
        rows: [],
        rowCount: typeof rows?.affectedRows === "number" ? rows.affectedRows : 0,
        insertId: rows?.insertId
      };
    },
    async end() {
      await mysqlPool.end();
    }
  };
}

function resolvePoolMode(connectionString) {
  if (!connectionString) {
    return "memory";
  }

  const normalized = connectionString.toLowerCase();
  if (normalized.startsWith("mysql://") || normalized.startsWith("mysql2://")) {
    return "mysql";
  }
  return "postgres";
}

async function createPoolForMode(mode, connectionString) {
  if (mode === "memory") {
    return createInMemoryPool();
  }
  if (mode === "mysql") {
    return createMySqlPool(connectionString);
  }
  return createPostgresPool(connectionString);
}

let poolMode = resolvePoolMode(DATABASE_URL);
let pool = await createPoolForMode(poolMode, DATABASE_URL);

function getMissingGoogleOAuthConfigKeys() {
  const missing = [];
  const idLooksLikeTemplate =
    typeof GOOGLE_CLIENT_ID === "string" &&
    GOOGLE_CLIENT_ID.includes("your-google-client-id");
  const secretLooksLikeTemplate =
    typeof GOOGLE_CLIENT_SECRET === "string" &&
    GOOGLE_CLIENT_SECRET.includes("your-google-client-secret");

  if (!GOOGLE_CLIENT_ID || idLooksLikeTemplate) {
    missing.push("GOOGLE_CLIENT_ID");
  }
  if (!GOOGLE_CLIENT_SECRET || secretLooksLikeTemplate) {
    missing.push("GOOGLE_CLIENT_SECRET");
  }
  return missing;
}

const missingGoogleOAuthConfigKeys = getMissingGoogleOAuthConfigKeys();
const googleConfigured = missingGoogleOAuthConfigKeys.length === 0;

function getGoogleOAuthNotConfiguredMessage() {
  const missing = missingGoogleOAuthConfigKeys.length
    ? ` Missing: ${missingGoogleOAuthConfigKeys.join(", ")}.`
    : "";
  return `Google OAuth is not configured or uses template values.${missing}`;
}

function getMissingEntraOAuthConfigKeys() {
  if (!entraConfiguredExplicitly) {
    return [];
  }

  const missing = [];
  const idLooksLikeTemplate =
    typeof ENTRA_CLIENT_ID === "string" &&
    ENTRA_CLIENT_ID.includes("your-entra-client-id");
  const secretLooksLikeTemplate =
    typeof ENTRA_CLIENT_SECRET === "string" &&
    ENTRA_CLIENT_SECRET.includes("your-entra-client-secret");
  const redirectLooksLikeTemplate =
    typeof ENTRA_REDIRECT_URI === "string" &&
    ENTRA_REDIRECT_URI.includes("your-backend-host");
  const discoveryLooksLikeTemplate =
    typeof ENTRA_DISCOVERY_URL === "string" &&
    ENTRA_DISCOVERY_URL.includes("your-tenant-subdomain");

  if (!ENTRA_CLIENT_ID || idLooksLikeTemplate) {
    missing.push("ENTRA_CLIENT_ID");
  }
  if (!ENTRA_CLIENT_SECRET || secretLooksLikeTemplate) {
    missing.push("ENTRA_CLIENT_SECRET");
  }
  if (!ENTRA_REDIRECT_URI || redirectLooksLikeTemplate) {
    missing.push("ENTRA_REDIRECT_URI");
  }
  if (!ENTRA_DISCOVERY_URL || discoveryLooksLikeTemplate) {
    missing.push("ENTRA_DISCOVERY_URL");
  }
  return missing;
}

const missingEntraOAuthConfigKeys = getMissingEntraOAuthConfigKeys();
const entraConfigured = missingEntraOAuthConfigKeys.length === 0;

function getEntraOAuthNotConfiguredMessage() {
  const missing = missingEntraOAuthConfigKeys.length
    ? ` Missing: ${missingEntraOAuthConfigKeys.join(", ")}.`
    : "";
  return `Microsoft Entra External ID OAuth is not configured or uses template values.${missing}`;
}

const oauthClient = googleConfigured
  ? new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI)
  : null;

let entraMetadataPromise = null;

async function getEntraMetadata() {
  if (!entraConfigured || !ENTRA_DISCOVERY_URL) {
    throw new Error(getEntraOAuthNotConfiguredMessage());
  }

  if (!entraMetadataPromise) {
    entraMetadataPromise = fetch(ENTRA_DISCOVERY_URL)
      .then(async (response) => {
        if (!response.ok) {
          const message = await response.text().catch(() => "");
          throw new Error(
            `Unable to load Entra OpenID configuration (status ${response.status}). ${message}`.trim()
          );
        }

        return response.json();
      })
      .then((metadata) => {
        const authorizationEndpoint = metadata?.authorization_endpoint;
        const tokenEndpoint = metadata?.token_endpoint;
        const userinfoEndpoint = metadata?.userinfo_endpoint;

        if (!authorizationEndpoint || !tokenEndpoint || !userinfoEndpoint) {
          throw new Error(
            "Entra OpenID configuration is missing authorization_endpoint, token_endpoint, or userinfo_endpoint."
          );
        }

        return {
          authorizationEndpoint,
          tokenEndpoint,
          userinfoEndpoint
        };
      })
      .catch((error) => {
        entraMetadataPromise = null;
        throw error;
      });
  }

  return entraMetadataPromise;
}

const PASSWORD_HASH_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32
};

app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: false
  })
);
app.use(express.json());

async function initDb() {
  if (poolMode === "mysql") {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(191) PRIMARY KEY,
        email VARCHAR(320) NOT NULL UNIQUE,
        password_hash TEXT,
        google_sub VARCHAR(191) UNIQUE,
        entra_sub VARCHAR(191) UNIQUE,
        first_name VARCHAR(191),
        last_name VARCHAR(191),
        avatar_url TEXT,
        auth_provider VARCHAR(32) NOT NULL DEFAULT 'email',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    const entraColumn = await pool.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'entra_sub'
    `);

    if (Number(entraColumn.rows[0]?.count ?? 0) === 0) {
      await pool.query("ALTER TABLE users ADD COLUMN entra_sub VARCHAR(191) UNIQUE NULL");
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_groups (
        id VARCHAR(191) PRIMARY KEY,
        name VARCHAR(${GROUP_NAME_MAX_LENGTH}) NOT NULL,
        owner_user_id VARCHAR(191) NOT NULL,
        weekly_goal INT NOT NULL,
        weekly_stake_usd INT NOT NULL,
        goal_cycle VARCHAR(16) NOT NULL DEFAULT '${DEFAULT_GOAL_CYCLE}',
        goal_start_day VARCHAR(16) NOT NULL DEFAULT '${DEFAULT_GOAL_START_DAY}',
        invite_code VARCHAR(64) NOT NULL UNIQUE,
        invite_code_expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_groups_owner FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_members (
        group_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        role VARCHAR(32) NOT NULL DEFAULT 'member',
        joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (group_id, user_id),
        CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES app_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_group_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_invites (
        id VARCHAR(191) PRIMARY KEY,
        group_id VARCHAR(191) NOT NULL,
        recipient_email VARCHAR(320) NOT NULL,
        sent_by_user_id VARCHAR(191) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        responded_at TIMESTAMP NULL DEFAULT NULL,
        CONSTRAINT fk_group_invites_group FOREIGN KEY (group_id) REFERENCES app_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_group_invites_sender FOREIGN KEY (sent_by_user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS group_member_cycle_counts (
          group_id VARCHAR(191) NOT NULL,
          user_id VARCHAR(191) NOT NULL,
          cycle_key VARCHAR(64) NOT NULL,
          applications_count INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (group_id, user_id, cycle_key),
          CONSTRAINT fk_group_member_cycle_counts_group
            FOREIGN KEY (group_id) REFERENCES app_groups(id) ON DELETE CASCADE,
          CONSTRAINT fk_group_member_cycle_counts_user
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      `);
    } catch (error) {
      disablePersistentMemberCycleCounts(error);
    }

    const goalCycleColumn = await pool.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'app_groups'
        AND column_name = 'goal_cycle'
    `);

    if (Number(goalCycleColumn.rows[0]?.count ?? 0) === 0) {
      await pool.query(
        `ALTER TABLE app_groups ADD COLUMN goal_cycle VARCHAR(16) NOT NULL DEFAULT '${DEFAULT_GOAL_CYCLE}'`
      );
    }

    const goalStartDayColumn = await pool.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'app_groups'
        AND column_name = 'goal_start_day'
    `);

    if (Number(goalStartDayColumn.rows[0]?.count ?? 0) === 0) {
      await pool.query(
        `ALTER TABLE app_groups ADD COLUMN goal_start_day VARCHAR(16) NOT NULL DEFAULT '${DEFAULT_GOAL_START_DAY}'`
      );
    }

    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      google_sub TEXT UNIQUE,
      entra_sub TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      avatar_url TEXT,
      auth_provider TEXT NOT NULL DEFAULT 'email',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_google_sub_idx
    ON users(google_sub);
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS entra_sub TEXT;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_entra_sub_idx
    ON users(entra_sub);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_groups (
      id TEXT PRIMARY KEY,
      name VARCHAR(${GROUP_NAME_MAX_LENGTH}) NOT NULL,
      owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      weekly_goal INT NOT NULL,
      weekly_stake_usd INT NOT NULL,
      goal_cycle TEXT NOT NULL DEFAULT '${DEFAULT_GOAL_CYCLE}',
      goal_start_day TEXT NOT NULL DEFAULT '${DEFAULT_GOAL_START_DAY}',
      invite_code TEXT NOT NULL UNIQUE,
      invite_code_expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    ALTER TABLE app_groups
    ADD COLUMN IF NOT EXISTS goal_cycle TEXT NOT NULL DEFAULT '${DEFAULT_GOAL_CYCLE}';
  `);

  await pool.query(`
    ALTER TABLE app_groups
    ADD COLUMN IF NOT EXISTS goal_start_day TEXT NOT NULL DEFAULT '${DEFAULT_GOAL_START_DAY}';
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_members (
      group_id TEXT NOT NULL REFERENCES app_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (group_id, user_id)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_invites (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES app_groups(id) ON DELETE CASCADE,
      recipient_email TEXT NOT NULL,
      sent_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ
    );
  `);

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_member_cycle_counts (
        group_id TEXT NOT NULL REFERENCES app_groups(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        cycle_key TEXT NOT NULL,
        applications_count INT NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (group_id, user_id, cycle_key)
      );
    `);
  } catch (error) {
    disablePersistentMemberCycleCounts(error);
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS group_members_user_idx
    ON group_members(user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS group_invites_recipient_status_idx
    ON group_invites(recipient_email, status);
  `);

  if (memberCycleCountsStoreMode === "database") {
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS group_member_cycle_counts_group_cycle_idx
        ON group_member_cycle_counts(group_id, cycle_key);
      `);
    } catch (error) {
      disablePersistentMemberCycleCounts(error);
    }
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function isValidAvatarUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return true;
  }
  if (trimmed.length > MAX_AVATAR_DATA_URL_LENGTH) {
    return false;
  }
  if (trimmed.startsWith("data:image/")) {
    return /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed);
  }
  return /^https?:\/\/\S+$/i.test(trimmed);
}

function normalizeGoalCycle(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ALLOWED_GOAL_CYCLES.has(normalized) ? normalized : DEFAULT_GOAL_CYCLE;
}

function normalizeGoalStartDay(value) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ALLOWED_GOAL_START_DAYS.has(normalized) ? normalized : DEFAULT_GOAL_START_DAY;
}

function normalizeInviteCode(value) {
  if (typeof value !== "string") {
    return "";
  }

  const compact = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  if (!compact) {
    return "";
  }

  if (compact.length === 4) {
    return `SQ-${compact}`;
  }

  if (compact.startsWith("SQ") && compact.length > 2) {
    return `SQ-${compact.slice(2)}`;
  }

  return compact;
}

function buildAuthResponse(user) {
  const token = jwt.sign(
    {
      sub: user.id,
      email: user.email
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );

  return {
    token,
    user: {
      id: user.id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      authProvider: user.auth_provider,
      createdAt: user.created_at
    }
  };
}

async function getUserById(id) {
  const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

async function requireUserById(id) {
  const user = await getUserById(id);
  if (!user) {
    throw new Error("Unable to load user after database write.");
  }
  return user;
}

async function getUserByEmail(email) {
  const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return result.rows[0] ?? null;
}

async function getUserByGoogleSub(googleSub) {
  const result = await pool.query("SELECT * FROM users WHERE google_sub = $1", [googleSub]);
  return result.rows[0] ?? null;
}

async function getUserByEntraSub(entraSub) {
  const result = await pool.query("SELECT * FROM users WHERE entra_sub = $1", [entraSub]);
  return result.rows[0] ?? null;
}

function asIsoTimestamp(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
  }

  return new Date().toISOString();
}

function getZonedParts(date, timeZone = APP_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).formatToParts(date);

  const byType = (type) => {
    const value = parts.find((part) => part.type === type)?.value;
    return Number(value ?? 0);
  };

  return {
    year: byType("year"),
    month: byType("month"),
    day: byType("day"),
    hour: byType("hour"),
    minute: byType("minute"),
    second: byType("second")
  };
}

function getOffsetMs(date, timeZone = APP_TIME_ZONE) {
  const zoned = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(
    zoned.year,
    zoned.month - 1,
    zoned.day,
    zoned.hour,
    zoned.minute,
    zoned.second
  );
  return asUtc - date.getTime();
}

function zonedLocalToUtc(year, month, day, hour, minute, second, timeZone = APP_TIME_ZONE) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = getOffsetMs(new Date(guess), timeZone);
  return new Date(guess - offset);
}

function toUtcCalendarDate(value, timeZone = APP_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const zoned = getZonedParts(date, timeZone);
  return new Date(Date.UTC(zoned.year, zoned.month - 1, zoned.day));
}

function addUtcCalendarDays(value, days) {
  const next = new Date(value);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function utcCalendarDateYmd(value) {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcCalendarEpoch(value) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function cycleLabelForGoalCycle(goalCycle) {
  if (goalCycle === "daily") {
    return "day";
  }
  if (goalCycle === "biweekly") {
    return "biweekly";
  }
  return "week";
}

function getCycleWindowForGroup(groupRow, referenceDate = new Date()) {
  const goalCycle = normalizeGoalCycle(groupRow.goal_cycle);
  const goalStartDay = normalizeGoalStartDay(groupRow.goal_start_day);
  const timeZone = APP_TIME_ZONE;
  const now = new Date(referenceDate);
  const localCalendarDay = toUtcCalendarDate(now, timeZone);

  if (goalCycle === "daily") {
    const startsAt = zonedLocalToUtc(
      localCalendarDay.getUTCFullYear(),
      localCalendarDay.getUTCMonth() + 1,
      localCalendarDay.getUTCDate(),
      0,
      0,
      0,
      timeZone
    );
    const endLocalCalendar = addUtcCalendarDays(localCalendarDay, 1);
    const endsAt = zonedLocalToUtc(
      endLocalCalendar.getUTCFullYear(),
      endLocalCalendar.getUTCMonth() + 1,
      endLocalCalendar.getUTCDate(),
      0,
      0,
      0,
      timeZone
    );
    return {
      goalCycle,
      label: cycleLabelForGoalCycle(goalCycle),
      startsAt,
      endsAt,
      cycleKey: `daily-${utcCalendarDateYmd(localCalendarDay)}`
    };
  }

  const startDayIndex = GOAL_START_DAY_TO_INDEX[goalStartDay] ?? GOAL_START_DAY_TO_INDEX.monday;
  const dayOffset = (localCalendarDay.getUTCDay() - startDayIndex + 7) % 7;
  let startsAtLocalCalendar = addUtcCalendarDays(localCalendarDay, -dayOffset);
  let durationDays = 7;

  if (goalCycle === "biweekly") {
    const anchorBase = toUtcCalendarDate(new Date(groupRow.created_at ?? Date.now()), timeZone);
    const anchorOffset = (anchorBase.getUTCDay() - startDayIndex + 7) % 7;
    const anchorStart = addUtcCalendarDays(anchorBase, -anchorOffset);
    const weekDiff = Math.floor(
      (utcCalendarEpoch(startsAtLocalCalendar) - utcCalendarEpoch(anchorStart)) /
        (7 * 24 * 60 * 60 * 1000)
    );
    if (Math.abs(weekDiff % 2) === 1) {
      startsAtLocalCalendar = addUtcCalendarDays(startsAtLocalCalendar, -7);
    }
    durationDays = 14;
  }

  const endsAtLocalCalendar = addUtcCalendarDays(startsAtLocalCalendar, durationDays);
  const startsAt = zonedLocalToUtc(
    startsAtLocalCalendar.getUTCFullYear(),
    startsAtLocalCalendar.getUTCMonth() + 1,
    startsAtLocalCalendar.getUTCDate(),
    0,
    0,
    0,
    timeZone
  );
  const endsAt = zonedLocalToUtc(
    endsAtLocalCalendar.getUTCFullYear(),
    endsAtLocalCalendar.getUTCMonth() + 1,
    endsAtLocalCalendar.getUTCDate(),
    0,
    0,
    0,
    timeZone
  );
  return {
    goalCycle,
    label: cycleLabelForGoalCycle(goalCycle),
    startsAt,
    endsAt,
    cycleKey: `${goalCycle}-${utcCalendarDateYmd(startsAtLocalCalendar)}`
  };
}

function nowPlusInviteExpiryDate() {
  return new Date(Date.now() + INVITE_EXPIRY_MS);
}

function resolveOwnerDisplayName(row) {
  const firstName = (row.owner_first_name ?? row.first_name ?? "").toString().trim();
  const lastName = (row.owner_last_name ?? row.last_name ?? "").toString().trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  return fullName || row.owner_email || row.email || "Group Owner";
}

function toGroupSummary(row) {
  const applicationGoal = Number(row.weekly_goal ?? 0);
  const stakeUsd = Number(row.weekly_stake_usd ?? 0);
  const goalCycle = normalizeGoalCycle(row.goal_cycle);
  const goalStartDay = normalizeGoalStartDay(row.goal_start_day);
  const normalizedRole = String(row.my_role ?? "").toLowerCase();
  const myRole = normalizedRole === "admin" || normalizedRole === "owner" ? "admin" : "member";

  return {
    id: row.id,
    name: row.name,
    applicationGoal,
    stakeUsd,
    goalCycle,
    goalStartDay,
    myRole,
    // Backward-compatible fields used in existing frontend code.
    weeklyGoal: applicationGoal,
    weeklyStakeUsd: stakeUsd,
    ownerUserId: row.owner_user_id,
    ownerName: resolveOwnerDisplayName(row),
    inviteCode: row.invite_code,
    inviteCodeExpiresAt: asIsoTimestamp(row.invite_code_expires_at),
    createdAt: asIsoTimestamp(row.created_at)
  };
}

function toInviteView(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    groupName: row.group_name ?? row.name,
    invitedBy: resolveOwnerDisplayName(row),
    goalCycle: normalizeGoalCycle(row.goal_cycle),
    goalStartDay: normalizeGoalStartDay(row.goal_start_day),
    applicationGoal: Number(row.weekly_goal ?? 0),
    stakeUsd: Number(row.weekly_stake_usd ?? 0),
    // Backward-compatible fields used in existing frontend code.
    goalApps: Number(row.weekly_goal ?? 0),
    weeklyStakeUsd: Number(row.weekly_stake_usd ?? 0),
    inviteCode: row.invite_code,
    expiresAt: asIsoTimestamp(row.expires_at),
    createdAt: asIsoTimestamp(row.created_at)
  };
}

function normalizeInviteEmails(value, currentUserEmail) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = normalizeEmail(entry);
    if (!normalized || normalized === currentUserEmail) {
      continue;
    }
    if (isValidEmail(normalized)) {
      unique.add(normalized);
    }
  }

  return [...unique];
}

async function doesInviteCodeExist(code) {
  const existing = await pool.query(
    `
      SELECT id
      FROM app_groups
      WHERE REPLACE(REPLACE(UPPER(invite_code), '-', ''), ' ', '') =
            REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
      LIMIT 1
    `,
    [code]
  );
  return existing.rows.length > 0;
}

async function createUniqueInviteCodeWithPreferred(preferredCode = "") {
  const normalizedPreferredCode = normalizeInviteCode(preferredCode);
  if (normalizedPreferredCode) {
    const exists = await doesInviteCodeExist(normalizedPreferredCode);
    if (!exists) {
      return normalizedPreferredCode;
    }
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `SQ-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const exists = await doesInviteCodeExist(candidate);
    if (!exists) {
      return candidate;
    }
  }

  throw new Error("Unable to generate a unique invite code.");
}

async function ensureGroupMembership(groupId, userId, role = "member") {
  const existing = await pool.query(
    `
      SELECT 1
      FROM group_members
      WHERE group_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [groupId, userId]
  );

  if (existing.rows.length) {
    return;
  }

  await pool.query(
    `
      INSERT INTO group_members (group_id, user_id, role)
      VALUES ($1, $2, $3)
    `,
    [groupId, userId, role]
  );
}

async function getGroupByIdForMember(groupId, userId) {
  const result = await pool.query(
    `
      SELECT
        g.*,
        gm.role AS my_role,
        owner.first_name AS owner_first_name,
        owner.last_name AS owner_last_name,
        owner.email AS owner_email
      FROM app_groups g
      INNER JOIN group_members gm
        ON gm.group_id = g.id
      LEFT JOIN users owner
        ON owner.id = g.owner_user_id
      WHERE g.id = $1
        AND gm.user_id = $2
      LIMIT 1
    `,
    [groupId, userId]
  );

  return result.rows[0] ?? null;
}

async function listGroupsForUser(userId) {
  const result = await pool.query(
    `
      SELECT
        g.*,
        gm.role AS my_role,
        owner.first_name AS owner_first_name,
        owner.last_name AS owner_last_name,
        owner.email AS owner_email
      FROM app_groups g
      INNER JOIN group_members gm
        ON gm.group_id = g.id
      LEFT JOIN users owner
        ON owner.id = g.owner_user_id
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
    `,
    [userId]
  );

  return result.rows.map((row) => toGroupSummary(row));
}

async function getGroupMemberRole(groupId, userId) {
  const result = await pool.query(
    `
      SELECT role
      FROM group_members
      WHERE group_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [groupId, userId]
  );

  const role = String(result.rows[0]?.role ?? "").toLowerCase();
  if (role === "admin" || role === "owner") {
    return "admin";
  }
  if (role === "member") {
    return "member";
  }
  return null;
}

async function isMemberInGroup(groupId, userId) {
  const result = await pool.query(
    `
      SELECT 1
      FROM group_members
      WHERE group_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [groupId, userId]
  );
  return result.rows.length > 0;
}

async function getGroupMembersWithProfiles(groupId) {
  const result = await pool.query(
    `
      SELECT
        gm.user_id,
        gm.role,
        gm.joined_at,
        u.first_name,
        u.last_name,
        u.email,
        u.avatar_url
      FROM group_members gm
      INNER JOIN users u
        ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY gm.joined_at ASC
    `,
    [groupId]
  );
  return result.rows;
}

async function getCycleCountsForGroup(groupId, cycleKey) {
  if (memberCycleCountsStoreMode !== "database") {
    return buildVolatileCycleCountMap(groupId, cycleKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT user_id, applications_count
        FROM group_member_cycle_counts
        WHERE group_id = $1
          AND cycle_key = $2
      `,
      [groupId, cycleKey]
    );

    return new Map(
      result.rows.map((row) => [String(row.user_id), Math.max(0, Number(row.applications_count ?? 0))])
    );
  } catch (error) {
    disablePersistentMemberCycleCounts(error);
    return buildVolatileCycleCountMap(groupId, cycleKey);
  }
}

function statusFromApplications(applicationsCount, goal) {
  if (!Number.isFinite(goal) || goal <= 0) {
    return "slow_start";
  }
  if (applicationsCount >= goal) {
    return "crushing";
  }
  const ratio = applicationsCount / goal;
  if (ratio >= 0.65) {
    return "on_track";
  }
  if (applicationsCount <= 0) {
    return "slow_start";
  }
  return "at_risk";
}

async function getCurrentCycleGroupActivity(groupId, currentUserId) {
  const group = await getGroupByIdForMember(groupId, currentUserId);
  if (!group) {
    return null;
  }

  const cycle = getCycleWindowForGroup(group, new Date());
  const members = await getGroupMembersWithProfiles(groupId);
  const countsByUserId = await getCycleCountsForGroup(groupId, cycle.cycleKey);
  const goal = Number(group.weekly_goal ?? 0);

  return {
    group: toGroupSummary(group),
    cycle: {
      key: cycle.cycleKey,
      label: cycle.label,
      startsAt: cycle.startsAt.toISOString(),
      endsAt: cycle.endsAt.toISOString()
    },
    members: members.map((member) => {
      const firstName = String(member.first_name ?? "").trim();
      const lastName = String(member.last_name ?? "").trim();
      const fullName = [firstName, lastName].filter(Boolean).join(" ").trim() || member.email;
      const applicationsCount = countsByUserId.get(String(member.user_id)) ?? 0;
      const normalizedRole = String(member.role ?? "").trim().toLowerCase();
      const role = normalizedRole === "admin" || normalizedRole === "owner" ? "admin" : "member";

      return {
        userId: String(member.user_id),
        name: fullName,
        email: String(member.email ?? ""),
        role,
        avatarUrl: member.avatar_url ?? null,
        isCurrentUser: String(member.user_id) === currentUserId,
        applicationsCount,
        goal,
        status: statusFromApplications(applicationsCount, goal)
      };
    })
  };
}

async function getMemberCycleCount(groupId, userId, cycleKey) {
  if (memberCycleCountsStoreMode !== "database") {
    return getVolatileCycleCount(groupId, userId, cycleKey);
  }

  try {
    const result = await pool.query(
      `
        SELECT applications_count
        FROM group_member_cycle_counts
        WHERE group_id = $1
          AND user_id = $2
          AND cycle_key = $3
        LIMIT 1
      `,
      [groupId, userId, cycleKey]
    );
    return Math.max(0, Number(result.rows[0]?.applications_count ?? 0));
  } catch (error) {
    disablePersistentMemberCycleCounts(error);
    return getVolatileCycleCount(groupId, userId, cycleKey);
  }
}

async function setMemberCycleCount(groupId, userId, cycleKey, applicationsCount) {
  const nextValue = Math.max(0, Math.floor(Number(applicationsCount) || 0));
  if (memberCycleCountsStoreMode !== "database") {
    return setVolatileCycleCount(groupId, userId, cycleKey, nextValue);
  }

  try {
    const existing = await pool.query(
      `
        SELECT 1
        FROM group_member_cycle_counts
        WHERE group_id = $1
          AND user_id = $2
          AND cycle_key = $3
        LIMIT 1
      `,
      [groupId, userId, cycleKey]
    );

    if (existing.rows.length) {
      await pool.query(
        `
          UPDATE group_member_cycle_counts
          SET applications_count = $4,
              updated_at = NOW()
          WHERE group_id = $1
            AND user_id = $2
            AND cycle_key = $3
        `,
        [groupId, userId, cycleKey, nextValue]
      );
      return nextValue;
    }

    await pool.query(
      `
        INSERT INTO group_member_cycle_counts (
          group_id,
          user_id,
          cycle_key,
          applications_count,
          updated_at
        )
        VALUES ($1, $2, $3, $4, NOW())
      `,
      [groupId, userId, cycleKey, nextValue]
    );
    return nextValue;
  } catch (error) {
    disablePersistentMemberCycleCounts(error);
    return setVolatileCycleCount(groupId, userId, cycleKey, nextValue);
  }
}

async function createEmailUser({ email, password, firstName, lastName }) {
  const passwordHash = await hash(password, PASSWORD_HASH_OPTIONS);
  const id = randomUUID();

  if (poolMode === "mysql") {
    await pool.query(
      `
        INSERT INTO users (
          id, email, password_hash, first_name, last_name, auth_provider
        )
        VALUES ($1, $2, $3, $4, $5, 'email')
      `,
      [id, email, passwordHash, firstName, lastName]
    );
    return requireUserById(id);
  }

  const result = await pool.query(
    `
      INSERT INTO users (
        id, email, password_hash, first_name, last_name, auth_provider
      )
      VALUES ($1, $2, $3, $4, $5, 'email')
      RETURNING *
    `,
    [id, email, passwordHash, firstName, lastName]
  );

  return result.rows[0] ?? null;
}

async function attachPasswordToExistingUser(user, password) {
  const passwordHash = await hash(password, PASSWORD_HASH_OPTIONS);
  const nextProvider = user.google_sub || user.entra_sub ? "hybrid" : "email";

  if (poolMode === "mysql") {
    await pool.query(
      `
        UPDATE users
        SET password_hash = $2,
            auth_provider = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [user.id, passwordHash, nextProvider]
    );
    return requireUserById(user.id);
  }

  const result = await pool.query(
    `
      UPDATE users
      SET password_hash = $2,
          auth_provider = $3,
          updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [user.id, passwordHash, nextProvider]
  );

  return result.rows[0] ?? null;
}

async function upsertGoogleUser(payload, options = {}) {
  if (!payload.email || !payload.sub) {
    throw new Error("Google payload missing required fields.");
  }

  const intent = options.intent === "signup" ? "signup" : "login";
  const email = normalizeEmail(payload.email);
  const googleSub = payload.sub;

  const byGoogleSub = await getUserByGoogleSub(googleSub);
  if (byGoogleSub) {
    if (intent === "signup") {
      throw new HttpError(
        409,
        "An account already exists with this Google email. Please log in instead."
      );
    }
    return byGoogleSub;
  }

  const byEmail = await getUserByEmail(email);
  if (byEmail) {
    if (intent === "signup") {
      throw new HttpError(
        409,
        "An account already exists with this email. Please log in instead."
      );
    }

    const nextProvider = byEmail.password_hash || byEmail.entra_sub ? "hybrid" : "google";

    if (poolMode === "mysql") {
      await pool.query(
        `
          UPDATE users
          SET google_sub = $2,
              auth_provider = $3,
              updated_at = NOW()
          WHERE id = $1
        `,
        [byEmail.id, googleSub, nextProvider]
      );
      return requireUserById(byEmail.id);
    }

    const updated = await pool.query(
      `
        UPDATE users
        SET google_sub = $2,
            auth_provider = $3,
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [byEmail.id, googleSub, nextProvider]
    );

    return updated.rows[0] ?? null;
  }

  const id = randomUUID();

  if (poolMode === "mysql") {
    await pool.query(
      `
        INSERT INTO users (
          id, email, google_sub, first_name, last_name, avatar_url, auth_provider
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'google')
      `,
      [
        id,
        email,
        googleSub,
        payload.given_name ?? null,
        payload.family_name ?? null,
        payload.picture ?? null
      ]
    );
    return requireUserById(id);
  }

  const created = await pool.query(
    `
      INSERT INTO users (
        id, email, google_sub, first_name, last_name, avatar_url, auth_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'google')
      RETURNING *
    `,
    [
      id,
      email,
      googleSub,
      payload.given_name ?? null,
      payload.family_name ?? null,
      payload.picture ?? null
    ]
  );

  return created.rows[0] ?? null;
}

async function exchangeGoogleCode(code, options = {}) {
  if (!oauthClient || !GOOGLE_CLIENT_ID) {
    throw new Error(getGoogleOAuthNotConfiguredMessage());
  }

  const redirectUri =
    typeof options.redirectUri === "string" && options.redirectUri.length > 0
      ? options.redirectUri
      : GOOGLE_REDIRECT_URI;
  const tokenResult = await oauthClient.getToken(
    redirectUri ? { code, redirect_uri: redirectUri } : code
  );
  oauthClient.setCredentials(tokenResult.tokens);

  if (!tokenResult.tokens.id_token) {
    throw new Error("Google did not return an id_token.");
  }

  const ticket = await oauthClient.verifyIdToken({
    idToken: tokenResult.tokens.id_token,
    audience: GOOGLE_CLIENT_ID
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Unable to validate Google identity payload.");
  }

  return upsertGoogleUser(payload, options);
}

function pickEntraEmail(payload) {
  if (typeof payload.email === "string" && payload.email.includes("@")) {
    return payload.email;
  }
  if (
    typeof payload.preferred_username === "string" &&
    payload.preferred_username.includes("@")
  ) {
    return payload.preferred_username;
  }
  if (Array.isArray(payload.emails)) {
    const first = payload.emails.find(
      (entry) => typeof entry === "string" && entry.includes("@")
    );
    if (first) {
      return first;
    }
  }
  return null;
}

async function upsertEntraUser(payload) {
  const emailRaw = pickEntraEmail(payload);
  const entraSub =
    (typeof payload.sub === "string" && payload.sub) ||
    (typeof payload.oid === "string" && payload.oid) ||
    null;

  if (!emailRaw || !entraSub) {
    throw new Error("Entra payload missing required fields (email/sub).");
  }

  const email = normalizeEmail(emailRaw);
  const byEntraSub = await getUserByEntraSub(entraSub);

  if (byEntraSub) {
    if (poolMode === "mysql") {
      await pool.query(
        `
          UPDATE users
          SET first_name = COALESCE($2, first_name),
              last_name = COALESCE($3, last_name),
              avatar_url = COALESCE($4, avatar_url),
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          byEntraSub.id,
          payload.given_name ?? null,
          payload.family_name ?? null,
          payload.picture ?? null
        ]
      );
      return requireUserById(byEntraSub.id);
    }

    const updated = await pool.query(
      `
        UPDATE users
        SET first_name = COALESCE($2, first_name),
            last_name = COALESCE($3, last_name),
            avatar_url = COALESCE($4, avatar_url),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        byEntraSub.id,
        payload.given_name ?? null,
        payload.family_name ?? null,
        payload.picture ?? null
      ]
    );

    return updated.rows[0] ?? null;
  }

  const byEmail = await getUserByEmail(email);
  if (byEmail) {
    const nextProvider = byEmail.password_hash || byEmail.google_sub ? "hybrid" : "entra";

    if (poolMode === "mysql") {
      await pool.query(
        `
          UPDATE users
          SET entra_sub = $2,
              auth_provider = $3,
              first_name = COALESCE($4, first_name),
              last_name = COALESCE($5, last_name),
              avatar_url = COALESCE($6, avatar_url),
              updated_at = NOW()
          WHERE id = $1
        `,
        [
          byEmail.id,
          entraSub,
          nextProvider,
          payload.given_name ?? null,
          payload.family_name ?? null,
          payload.picture ?? null
        ]
      );
      return requireUserById(byEmail.id);
    }

    const updated = await pool.query(
      `
        UPDATE users
        SET entra_sub = $2,
            auth_provider = $3,
            first_name = COALESCE($4, first_name),
            last_name = COALESCE($5, last_name),
            avatar_url = COALESCE($6, avatar_url),
            updated_at = NOW()
        WHERE id = $1
        RETURNING *
      `,
      [
        byEmail.id,
        entraSub,
        nextProvider,
        payload.given_name ?? null,
        payload.family_name ?? null,
        payload.picture ?? null
      ]
    );

    return updated.rows[0] ?? null;
  }

  const id = randomUUID();

  if (poolMode === "mysql") {
    await pool.query(
      `
        INSERT INTO users (
          id, email, entra_sub, first_name, last_name, avatar_url, auth_provider
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'entra')
      `,
      [
        id,
        email,
        entraSub,
        payload.given_name ?? null,
        payload.family_name ?? null,
        payload.picture ?? null
      ]
    );
    return requireUserById(id);
  }

  const created = await pool.query(
    `
      INSERT INTO users (
        id, email, entra_sub, first_name, last_name, avatar_url, auth_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'entra')
      RETURNING *
    `,
    [
      id,
      email,
      entraSub,
      payload.given_name ?? null,
      payload.family_name ?? null,
      payload.picture ?? null
    ]
  );

  return created.rows[0] ?? null;
}

async function exchangeEntraCode(code) {
  if (
    !entraConfigured ||
    !ENTRA_CLIENT_ID ||
    !ENTRA_CLIENT_SECRET ||
    !ENTRA_REDIRECT_URI
  ) {
    throw new Error(getEntraOAuthNotConfiguredMessage());
  }

  const metadata = await getEntraMetadata();

  const params = new URLSearchParams({
    client_id: ENTRA_CLIENT_ID,
    client_secret: ENTRA_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: ENTRA_REDIRECT_URI
  });

  const tokenResponse = await fetch(metadata.tokenEndpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });

  const tokenPayload = await tokenResponse
    .json()
    .catch(() => null);

  if (!tokenResponse.ok) {
    const description =
      tokenPayload && typeof tokenPayload === "object"
        ? tokenPayload.error_description ?? tokenPayload.error
        : "";
    throw new Error(
      `Entra token exchange failed (status ${tokenResponse.status}). ${description ?? ""}`.trim()
    );
  }

  const accessToken =
    tokenPayload && typeof tokenPayload === "object" ? tokenPayload.access_token : null;
  if (!accessToken) {
    throw new Error("Entra did not return access_token.");
  }

  const profileResponse = await fetch(metadata.userinfoEndpoint, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!profileResponse.ok) {
    const message = await profileResponse.text().catch(() => "");
    throw new Error(
      `Unable to fetch Entra user profile (status ${profileResponse.status}). ${message}`.trim()
    );
  }

  const payload = await profileResponse.json().catch(() => null);

  if (!payload || typeof payload !== "object") {
    throw new Error("Unable to read Entra user profile payload.");
  }

  return upsertEntraUser(payload);
}

function createGoogleAuthUrl(
  redirectPath = "/dashboard",
  mode = "redirect",
  intent = "login",
  redirectUri = GOOGLE_REDIRECT_URI
) {
  if (!oauthClient) {
    throw new Error(getGoogleOAuthNotConfiguredMessage());
  }

  const normalizedRedirectPath =
    typeof redirectPath === "string" && redirectPath.startsWith("/")
      ? redirectPath
      : "/dashboard";
  const normalizedMode = mode === "popup" ? "popup" : "redirect";
  const normalizedIntent = intent === "signup" ? "signup" : "login";
  const state = Buffer.from(
    JSON.stringify({
      redirectPath: normalizedRedirectPath,
      mode: normalizedMode,
      intent: normalizedIntent
    }),
    "utf-8"
  ).toString("base64url");

  return oauthClient.generateAuthUrl({
    access_type: "offline",
    prompt: "select_account consent",
    scope: ["openid", "email", "profile"],
    state,
    redirect_uri: redirectUri
  });
}

async function createEntraAuthUrl(redirectPath = "/dashboard", mode = "redirect") {
  if (
    !entraConfigured ||
    !ENTRA_CLIENT_ID ||
    !ENTRA_REDIRECT_URI
  ) {
    throw new Error(getEntraOAuthNotConfiguredMessage());
  }

  const metadata = await getEntraMetadata();
  const normalizedRedirectPath =
    typeof redirectPath === "string" && redirectPath.startsWith("/")
      ? redirectPath
      : "/dashboard";
  const normalizedMode = mode === "popup" ? "popup" : "redirect";
  const state = Buffer.from(
    JSON.stringify({ redirectPath: normalizedRedirectPath, mode: normalizedMode }),
    "utf-8"
  ).toString("base64url");

  const url = new URL(metadata.authorizationEndpoint);
  url.searchParams.set("client_id", ENTRA_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", ENTRA_REDIRECT_URI);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", ENTRA_SCOPES);
  url.searchParams.set("prompt", "select_account");
  url.searchParams.set("state", state);

  return url.toString();
}

function parseOAuthState(stateEncoded) {
  let redirectPath = "/dashboard";
  let mode = "redirect";
  let intent = "login";

  if (!stateEncoded) {
    return { redirectPath, mode, intent };
  }

  try {
    const parsed = JSON.parse(Buffer.from(stateEncoded, "base64url").toString("utf-8"));

    if (typeof parsed.redirectPath === "string" && parsed.redirectPath.startsWith("/")) {
      redirectPath = parsed.redirectPath;
    }

    if (parsed.mode === "popup") {
      mode = "popup";
    }

    if (parsed.intent === "signup") {
      intent = "signup";
    }
  } catch {
    // Ignore invalid state payloads and fall back to defaults.
  }

  return { redirectPath, mode, intent };
}

function isLocalFrontendUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function getForwardedHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  if (typeof value === "string") {
    const [first] = value.split(",");
    return first?.trim() ?? "";
  }

  return "";
}

function isLocalHostName(host) {
  if (!host) {
    return false;
  }
  const normalized = String(host).trim().toLowerCase();
  return (
    normalized.startsWith("localhost") ||
    normalized.startsWith("127.0.0.1") ||
    normalized.startsWith("[::1]")
  );
}

function resolveDeploymentFallbackOrigin(fallbackOrigin) {
  const websiteHostname = process.env.WEBSITE_HOSTNAME?.trim();
  if (websiteHostname && !isLocalHostName(websiteHostname)) {
    return `https://${websiteHostname}`;
  }
  return fallbackOrigin;
}

function resolveRequestOrigin(req, fallbackOrigin) {
  const forwardedProto = getForwardedHeaderValue(req.headers["x-forwarded-proto"]);
  const protocol = forwardedProto || req.protocol || "https";

  const hostCandidates = [
    getForwardedHeaderValue(req.headers["x-forwarded-host"]),
    getForwardedHeaderValue(req.headers["x-original-host"]),
    getForwardedHeaderValue(req.headers["x-arr-original-host"]),
    req.get("host")
  ].filter(Boolean);
  const host = hostCandidates.find((candidate) => !isLocalHostName(candidate)) || hostCandidates[0];

  if (!host) {
    return fallbackOrigin;
  }

  return `${protocol}://${host}`;
}

function resolveFrontendBaseUrl(req) {
  const configuredUrl = FRONTEND_URL?.trim();

  if (!configuredUrl) {
    const deploymentFallback = resolveDeploymentFallbackOrigin("http://localhost:5173");
    return resolveRequestOrigin(req, deploymentFallback);
  }

  if (!isLocalFrontendUrl(configuredUrl)) {
    return configuredUrl;
  }

  const requestOrigin = resolveRequestOrigin(req, configuredUrl);
  if (!isLocalFrontendUrl(requestOrigin)) {
    return requestOrigin;
  }

  return resolveDeploymentFallbackOrigin(configuredUrl);
}

function resolveGoogleRedirectUri(req) {
  const configuredRedirectUri = GOOGLE_REDIRECT_URI?.trim();

  if (configuredRedirectUri && !isLocalFrontendUrl(configuredRedirectUri)) {
    try {
      const parsed = new URL(configuredRedirectUri);
      if (parsed.pathname === "/api/auth/google/callback") {
        return configuredRedirectUri;
      }
    } catch {
      // Fall back to request-derived callback URL below.
    }
  }

  if (configuredRedirectUri && isLocalFrontendUrl(configuredRedirectUri)) {
    const requestOrigin = resolveRequestOrigin(req, configuredRedirectUri);
    if (!isLocalFrontendUrl(requestOrigin)) {
      return new URL("/api/auth/google/callback", requestOrigin).toString();
    }

    const deploymentFallback = resolveDeploymentFallbackOrigin(configuredRedirectUri);
    if (!isLocalFrontendUrl(deploymentFallback)) {
      return new URL("/api/auth/google/callback", deploymentFallback).toString();
    }

    return configuredRedirectUri;
  }

  const callbackOrigin = resolveRequestOrigin(req, resolveFrontendBaseUrl(req));
  return new URL("/api/auth/google/callback", callbackOrigin).toString();
}

function renderPopupBridge(res, payload, fallbackUrl) {
  const safePayload = JSON.stringify(payload).replace(/</g, "\\u003c");
  const safeFallbackUrl = JSON.stringify(fallbackUrl).replace(/</g, "\\u003c");
  const safeTargetOrigin = JSON.stringify("*");

  return res.status(200).type("html").send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>IncentApply Auth</title>
  </head>
  <body>
    <script>
      (function () {
        var payload = ${safePayload};
        var fallbackUrl = ${safeFallbackUrl};
        var targetOrigin = ${safeTargetOrigin};

        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, targetOrigin);
        }
        window.setTimeout(function () {
          window.close();
        }, 150);

        window.setTimeout(function () {
          window.location.replace(fallbackUrl);
        }, 450);
      })();
    </script>
  </body>
</html>`);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing bearer token." });
  }

  const token = authHeader.slice("Bearer ".length);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.auth = decoded;
    return next();
  } catch {
    return res.status(401).json({ error: "Invalid token." });
  }
}

app.get("/api/health", async (_, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true });
});

app.post("/api/auth/signup", async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body ?? {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const normalized = normalizeEmail(email);
    const existing = await getUserByEmail(normalized);
    if (existing?.password_hash) {
      return res.status(409).json({ error: "Account already exists with email/password." });
    }

    const user = existing
      ? await attachPasswordToExistingUser(existing, String(password))
      : await createEmailUser({
          email: normalized,
          password: String(password),
          firstName: firstName ? String(firstName) : null,
          lastName: lastName ? String(lastName) : null
        });

    return res.status(201).json(buildAuthResponse(user));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Signup failed." });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body ?? {};
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const user = await getUserByEmail(normalizeEmail(String(email)));
    if (!user?.password_hash) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    const valid = await verify(user.password_hash, String(password));
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials." });
    }

    return res.status(200).json(buildAuthResponse(user));
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Login failed." });
  }
});

app.get("/api/auth/google/start", async (req, res) => {
  try {
    const redirectPath =
      typeof req.query.redirect === "string" ? req.query.redirect : "/dashboard";
    const mode = req.query.mode === "popup" ? "popup" : "redirect";
    const intent = req.query.intent === "signup" ? "signup" : "login";
    const redirectUri = resolveGoogleRedirectUri(req);
    const url = createGoogleAuthUrl(redirectPath, mode, intent, redirectUri);
    return res.redirect(302, url);
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: error instanceof Error ? error.message : "Failed to start Google OAuth."
    });
  }
});

app.get("/api/auth/google/url", async (req, res) => {
  try {
    const redirectPath =
      typeof req.query.redirect === "string" ? req.query.redirect : "/dashboard";
    const mode = req.query.mode === "popup" ? "popup" : "redirect";
    const intent = req.query.intent === "signup" ? "signup" : "login";
    const redirectUri = resolveGoogleRedirectUri(req);
    const url = createGoogleAuthUrl(redirectPath, mode, intent, redirectUri);

    return res.status(200).json({ url });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return res
      .status(statusCode)
      .json({ error: error instanceof Error ? error.message : "Failed to create OAuth URL." });
  }
});

app.post("/api/auth/google/exchange", async (req, res) => {
  try {
    const { code, intent } = req.body ?? {};
    if (!code) {
      return res.status(400).json({ error: "Google authorization code is required." });
    }

    const normalizedIntent = intent === "signup" ? "signup" : "login";
    const redirectUri = resolveGoogleRedirectUri(req);
    const user = await exchangeGoogleCode(String(code), {
      intent: normalizedIntent,
      redirectUri
    });
    return res.status(200).json(buildAuthResponse(user));
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return res
      .status(statusCode)
      .json({ error: error instanceof Error ? error.message : "Google OAuth exchange failed." });
  }
});

app.post("/api/auth/entra/exchange", async (req, res) => {
  try {
    const { code } = req.body ?? {};
    if (!code) {
      return res.status(400).json({ error: "Microsoft Entra authorization code is required." });
    }

    const user = await exchangeEntraCode(String(code));
    return res.status(200).json(buildAuthResponse(user));
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Microsoft Entra OAuth exchange failed." });
  }
});

app.get("/api/auth/google/callback", async (req, res) => {
  const stateEncoded = typeof req.query.state === "string" ? req.query.state : "";
  const oauthState = parseOAuthState(stateEncoded);
  const frontendBaseUrl = resolveFrontendBaseUrl(req);
  const redirectUri = resolveGoogleRedirectUri(req);

  try {
    const oauthError = typeof req.query.error === "string" ? req.query.error : "";
    if (oauthError) {
      throw new Error(`Google authorization failed: ${oauthError}.`);
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      throw new Error("Missing Google OAuth code.");
    }

    const user = await exchangeGoogleCode(code, {
      intent: oauthState.intent,
      redirectUri
    });
    const auth = buildAuthResponse(user);

    // For SPA convenience in development this redirects with token.
    // In production prefer httpOnly secure cookies instead of query params.
    const redirectUrl = new URL(oauthState.redirectPath, frontendBaseUrl);
    redirectUrl.searchParams.set("token", auth.token);
    redirectUrl.searchParams.set("email", auth.user.email);

    if (oauthState.mode === "popup") {
      return renderPopupBridge(
        res,
        {
          type: "incentapply:oauth",
          status: "success",
          auth
        },
        redirectUrl.toString()
      );
    }

    return res.redirect(302, redirectUrl.toString());
  } catch (error) {
    const fallbackPath = oauthState.intent === "signup" ? "/auth/register" : "/auth/login";
    if (oauthState.mode === "popup") {
      const fallbackUrl = new URL(fallbackPath, frontendBaseUrl);
      fallbackUrl.searchParams.set("oauthError", "1");
      fallbackUrl.searchParams.set(
        "message",
        error instanceof Error ? error.message : "Google callback failed."
      );

      return renderPopupBridge(
        res,
        {
          type: "incentapply:oauth",
          status: "error",
          error: error instanceof Error ? error.message : "Google callback failed."
        },
        fallbackUrl.toString()
      );
    }

    const fallbackUrl = new URL(fallbackPath, frontendBaseUrl);
    fallbackUrl.searchParams.set("oauthError", "1");
    fallbackUrl.searchParams.set(
      "message",
      error instanceof Error ? error.message : "Google callback failed."
    );
    return res.redirect(302, fallbackUrl.toString());
  }
});

app.get("/api/auth/entra/start", async (req, res) => {
  try {
    const redirectPath =
      typeof req.query.redirect === "string" ? req.query.redirect : "/dashboard";
    const mode = req.query.mode === "popup" ? "popup" : "redirect";
    const url = await createEntraAuthUrl(redirectPath, mode);
    return res.redirect(302, url);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to start Entra OAuth."
    });
  }
});

app.get("/api/auth/entra/url", async (req, res) => {
  try {
    const redirectPath =
      typeof req.query.redirect === "string" ? req.query.redirect : "/dashboard";
    const mode = req.query.mode === "popup" ? "popup" : "redirect";
    const url = await createEntraAuthUrl(redirectPath, mode);

    return res.status(200).json({ url });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Failed to create Entra OAuth URL." });
  }
});

app.get("/api/auth/entra/callback", async (req, res) => {
  const stateEncoded = typeof req.query.state === "string" ? req.query.state : "";
  const oauthState = parseOAuthState(stateEncoded);
  const frontendBaseUrl = resolveFrontendBaseUrl(req);

  try {
    const oauthError = typeof req.query.error === "string" ? req.query.error : "";
    if (oauthError) {
      throw new Error(`Microsoft Entra authorization failed: ${oauthError}.`);
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      throw new Error("Missing Microsoft Entra OAuth code.");
    }

    const user = await exchangeEntraCode(code);
    const auth = buildAuthResponse(user);

    const redirectUrl = new URL(oauthState.redirectPath, frontendBaseUrl);
    redirectUrl.searchParams.set("token", auth.token);
    redirectUrl.searchParams.set("email", auth.user.email);

    if (oauthState.mode === "popup") {
      return renderPopupBridge(
        res,
        {
          type: "incentapply:oauth",
          status: "success",
          auth
        },
        redirectUrl.toString()
      );
    }

    return res.redirect(302, redirectUrl.toString());
  } catch (error) {
    if (oauthState.mode === "popup") {
      const fallbackUrl = new URL("/auth/login", frontendBaseUrl);
      fallbackUrl.searchParams.set("oauthError", "1");
      fallbackUrl.searchParams.set(
        "message",
        error instanceof Error ? error.message : "Microsoft Entra callback failed."
      );

      return renderPopupBridge(
        res,
        {
          type: "incentapply:oauth",
          status: "error",
          error: error instanceof Error ? error.message : "Microsoft Entra callback failed."
        },
        fallbackUrl.toString()
      );
    }

    const fallbackUrl = new URL("/auth/login", frontendBaseUrl);
    fallbackUrl.searchParams.set("oauthError", "1");
    fallbackUrl.searchParams.set(
      "message",
      error instanceof Error ? error.message : "Microsoft Entra callback failed."
    );
    return res.redirect(302, fallbackUrl.toString());
  }
});

app.get("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    const user = userId ? await getUserById(userId) : null;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.first_name,
        lastName: user.last_name,
        avatarUrl: user.avatar_url,
        authProvider: user.auth_provider,
        createdAt: user.created_at
      }
    });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to fetch profile." });
  }
});

app.patch("/api/auth/me", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const firstNameRaw = typeof req.body?.firstName === "string" ? req.body.firstName : "";
    const lastNameRaw = typeof req.body?.lastName === "string" ? req.body.lastName : "";
    const emailRaw = typeof req.body?.email === "string" ? req.body.email : "";
    const hasAvatarUrlField = Object.prototype.hasOwnProperty.call(req.body ?? {}, "avatarUrl");
    const avatarUrlRaw = hasAvatarUrlField ? req.body?.avatarUrl : undefined;

    const firstName = firstNameRaw.trim();
    const lastName = lastNameRaw.trim();
    const email = normalizeEmail(emailRaw);
    const avatarUrl =
      avatarUrlRaw === undefined
        ? undefined
        : avatarUrlRaw === null
          ? null
          : typeof avatarUrlRaw === "string"
            ? avatarUrlRaw.trim()
            : "__invalid__";

    if (!firstName || !lastName || !email) {
      return res
        .status(400)
        .json({ error: "First name, last name, and email are required." });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }
    if (avatarUrl === "__invalid__") {
      return res.status(400).json({ error: "Avatar URL must be a string or null." });
    }
    if (
      typeof avatarUrl === "string" &&
      avatarUrl.length > 0 &&
      !isValidAvatarUrl(avatarUrl)
    ) {
      return res.status(400).json({
        error:
          "Avatar image is invalid or too large. Upload a smaller image (PNG/JPG/WEBP/GIF)."
      });
    }

    const existingWithEmail = await getUserByEmail(email);
    if (existingWithEmail && existingWithEmail.id !== userId) {
      return res.status(409).json({ error: "An account already exists with this email." });
    }

    if (hasAvatarUrlField) {
      await pool.query(
        `
          UPDATE users
          SET first_name = $2,
              last_name = $3,
              email = $4,
              avatar_url = $5,
              updated_at = NOW()
          WHERE id = $1
        `,
        [userId, firstName, lastName, email, avatarUrl && avatarUrl.length ? avatarUrl : null]
      );
    } else {
      await pool.query(
        `
          UPDATE users
          SET first_name = $2,
              last_name = $3,
              email = $4,
              updated_at = NOW()
          WHERE id = $1
        `,
        [userId, firstName, lastName, email]
      );
    }

    const updatedUser = await getUserById(userId);
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found." });
    }

    return res.status(200).json({
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.first_name,
        lastName: updatedUser.last_name,
        avatarUrl: updatedUser.avatar_url,
        authProvider: updatedUser.auth_provider,
        createdAt: updatedUser.created_at
      }
    });
  } catch (error) {
    return res
      .status(500)
      .json({ error: error instanceof Error ? error.message : "Unable to update profile." });
  }
});

app.get("/api/users/exists", authMiddleware, async (req, res) => {
  try {
    const emailRaw = typeof req.query.email === "string" ? req.query.email : "";
    const normalizedEmail = normalizeEmail(emailRaw);

    if (!normalizedEmail || !isValidEmail(normalizedEmail)) {
      return res.status(400).json({ error: "A valid email query parameter is required." });
    }

    const existingUser = await getUserByEmail(normalizedEmail);
    return res.status(200).json({ exists: Boolean(existingUser) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to check user existence."
    });
  }
});

app.get("/api/groups", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groups = await listGroupsForUser(userId);
    return res.status(200).json({ groups });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch groups."
    });
  }
});

app.post("/api/groups", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    const user = userId ? await getUserById(userId) : null;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const {
      name,
      applicationGoal,
      weeklyGoal,
      stakeUsd,
      weeklyStakeUsd,
      goalCycle,
      goalStartDay,
      inviteEmails,
      inviteCode: requestedInviteCode
    } = req.body ?? {};
    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName) {
      return res.status(400).json({ error: "Group name is required." });
    }
    if (normalizedName.length > GROUP_NAME_MAX_LENGTH) {
      return res.status(400).json({
        error: `Group name must be ${GROUP_NAME_MAX_LENGTH} characters or fewer.`
      });
    }

    const parsedGoal = Number(applicationGoal ?? weeklyGoal);
    if (!Number.isFinite(parsedGoal) || parsedGoal < 1) {
      return res.status(400).json({ error: "Application goal must be at least 1." });
    }

    const parsedStake = Number(stakeUsd ?? weeklyStakeUsd);
    if (!Number.isFinite(parsedStake) || parsedStake < 0) {
      return res.status(400).json({ error: "Stake must be zero or greater." });
    }
    const normalizedCycle = normalizeGoalCycle(goalCycle);
    const normalizedGoalStartDay = normalizeGoalStartDay(goalStartDay);
    if (
      normalizedCycle !== "daily" &&
      !ALLOWED_GOAL_START_DAYS.has(String(goalStartDay ?? "").trim().toLowerCase())
    ) {
      return res.status(400).json({
        error: "Goal start day is required for weekly and biweekly cycles."
      });
    }

    const recipients = normalizeInviteEmails(inviteEmails, user.email);
    const missingRecipients = [];
    for (const recipientEmail of recipients) {
      const recipientUser = await getUserByEmail(recipientEmail);
      if (!recipientUser) {
        missingRecipients.push(recipientEmail);
      }
    }

    if (missingRecipients.length) {
      return res.status(400).json({
        error: `These users do not exist: ${missingRecipients.join(
          ", "
        )}. Ask them to sign up first or share the invite code instead.`
      });
    }

    const expiresAt = nowPlusInviteExpiryDate();
    const inviteExpiryValue = poolMode === "mysql" ? formatMySqlTimestamp(expiresAt) : expiresAt;
    const inviteCode = await createUniqueInviteCodeWithPreferred(requestedInviteCode);
    const groupId = randomUUID();

    await pool.query(
      `
        INSERT INTO app_groups (
          id,
          name,
          owner_user_id,
          weekly_goal,
          weekly_stake_usd,
          goal_cycle,
          goal_start_day,
          invite_code,
          invite_code_expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        groupId,
        normalizedName,
        user.id,
        Math.round(parsedGoal),
        Math.round(parsedStake),
        normalizedCycle,
        normalizedGoalStartDay,
        inviteCode,
        inviteExpiryValue
      ]
    );

    await ensureGroupMembership(groupId, user.id, "admin");

    for (const recipientEmail of recipients) {
      await pool.query(
        `
          INSERT INTO group_invites (
            id,
            group_id,
            recipient_email,
            sent_by_user_id,
            status,
            expires_at
          )
          VALUES ($1, $2, $3, $4, 'pending', $5)
        `,
        [randomUUID(), groupId, recipientEmail, user.id, inviteExpiryValue]
      );
    }

    const createdGroup = await getGroupByIdForMember(groupId, user.id);
    if (!createdGroup) {
      return res.status(500).json({ error: "Unable to load created group." });
    }

    return res.status(201).json({
      group: toGroupSummary(createdGroup),
      invitesCreated: recipients.length
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to create group."
    });
  }
});

app.post("/api/groups/join-code", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    const user = userId ? await getUserById(userId) : null;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const inviteCode = normalizeInviteCode(req.body?.inviteCode);
    if (!inviteCode) {
      return res.status(400).json({ error: "Invite code is required." });
    }

    const groupResult = await pool.query(
      `
        SELECT
          g.*,
          owner.first_name AS owner_first_name,
          owner.last_name AS owner_last_name,
          owner.email AS owner_email
        FROM app_groups g
        LEFT JOIN users owner
          ON owner.id = g.owner_user_id
        WHERE REPLACE(REPLACE(UPPER(g.invite_code), '-', ''), ' ', '') =
              REPLACE(REPLACE(UPPER($1), '-', ''), ' ', '')
        LIMIT 1
      `,
      [inviteCode]
    );

    const group = groupResult.rows[0] ?? null;
    if (!group) {
      return res.status(404).json({ error: "Invalid invite code." });
    }

    if (new Date(group.invite_code_expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ error: "This invite code has expired." });
    }

    await ensureGroupMembership(group.id, user.id);
    await pool.query(
      `
        UPDATE group_invites
        SET status = 'accepted',
            responded_at = NOW(),
            updated_at = NOW()
        WHERE group_id = $1
          AND recipient_email = $2
          AND status = 'pending'
          AND expires_at > NOW()
      `,
      [group.id, normalizeEmail(user.email)]
    );

    const joinedGroup = await getGroupByIdForMember(group.id, user.id);
    if (!joinedGroup) {
      return res.status(500).json({ error: "Unable to load joined group." });
    }

    return res.status(200).json({ group: toGroupSummary(joinedGroup) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to join group."
    });
  }
});

app.get("/api/groups/invites/pending", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    const user = userId ? await getUserById(userId) : null;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const result = await pool.query(
      `
        SELECT
          gi.*,
          g.name AS group_name,
          g.weekly_goal,
          g.weekly_stake_usd,
          g.goal_cycle,
          g.goal_start_day,
          g.invite_code,
          g.invite_code_expires_at,
          owner.first_name AS owner_first_name,
          owner.last_name AS owner_last_name,
          owner.email AS owner_email
        FROM group_invites gi
        INNER JOIN app_groups g
          ON g.id = gi.group_id
        LEFT JOIN users owner
          ON owner.id = g.owner_user_id
        WHERE gi.recipient_email = $1
          AND gi.status = 'pending'
          AND gi.expires_at > NOW()
          AND g.invite_code_expires_at > NOW()
        ORDER BY gi.created_at DESC
      `,
      [normalizeEmail(user.email)]
    );

    return res.status(200).json({ invites: result.rows.map((row) => toInviteView(row)) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch pending invites."
    });
  }
});

app.post("/api/groups/invites/:inviteId/accept", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    const user = userId ? await getUserById(userId) : null;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const inviteId = String(req.params.inviteId ?? "").trim();
    if (!inviteId) {
      return res.status(400).json({ error: "Invite id is required." });
    }

    const inviteResult = await pool.query(
      `
        SELECT
          gi.*,
          g.name AS group_name,
          g.weekly_goal,
          g.weekly_stake_usd,
          g.invite_code,
          g.invite_code_expires_at
        FROM group_invites gi
        INNER JOIN app_groups g
          ON g.id = gi.group_id
        WHERE gi.id = $1
          AND gi.recipient_email = $2
        LIMIT 1
      `,
      [inviteId, normalizeEmail(user.email)]
    );

    const invite = inviteResult.rows[0] ?? null;
    if (!invite) {
      return res.status(404).json({ error: "Invite not found." });
    }

    if (invite.status !== "pending") {
      return res.status(400).json({ error: "Invite has already been handled." });
    }

    const expired =
      new Date(invite.expires_at).getTime() <= Date.now() ||
      new Date(invite.invite_code_expires_at).getTime() <= Date.now();
    if (expired) {
      return res.status(410).json({ error: "Invite has expired." });
    }

    await ensureGroupMembership(invite.group_id, user.id);
    await pool.query(
      `
        UPDATE group_invites
        SET status = 'accepted',
            responded_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [inviteId]
    );

    const joinedGroup = await getGroupByIdForMember(invite.group_id, user.id);
    if (!joinedGroup) {
      return res.status(500).json({ error: "Unable to load joined group." });
    }

    return res.status(200).json({ group: toGroupSummary(joinedGroup) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to accept invite."
    });
  }
});

app.post("/api/groups/invites/:inviteId/reject", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    const user = userId ? await getUserById(userId) : null;
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }

    const inviteId = String(req.params.inviteId ?? "").trim();
    if (!inviteId) {
      return res.status(400).json({ error: "Invite id is required." });
    }

    const inviteResult = await pool.query(
      `
        SELECT id, status, expires_at
        FROM group_invites
        WHERE id = $1
          AND recipient_email = $2
        LIMIT 1
      `,
      [inviteId, normalizeEmail(user.email)]
    );

    const invite = inviteResult.rows[0] ?? null;
    if (!invite) {
      return res.status(404).json({ error: "Invite not found." });
    }

    if (invite.status !== "pending") {
      return res.status(400).json({ error: "Invite has already been handled." });
    }

    if (new Date(invite.expires_at).getTime() <= Date.now()) {
      return res.status(410).json({ error: "Invite has expired." });
    }

    await pool.query(
      `
        UPDATE group_invites
        SET status = 'rejected',
            responded_at = NOW(),
            updated_at = NOW()
        WHERE id = $1
      `,
      [inviteId]
    );

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to reject invite."
    });
  }
});

app.patch("/api/groups/:groupId/settings", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    if (!groupId) {
      return res.status(400).json({ error: "Group id is required." });
    }

    const role = await getGroupMemberRole(groupId, userId);
    if (!role) {
      return res.status(404).json({ error: "Group not found." });
    }
    if (role !== "admin") {
      return res.status(403).json({ error: "Only admins can update group settings." });
    }

    const { applicationGoal, weeklyGoal, stakeUsd, weeklyStakeUsd, goalCycle, goalStartDay } =
      req.body ?? {};
    const parsedGoal = Number(applicationGoal ?? weeklyGoal);
    if (!Number.isFinite(parsedGoal) || parsedGoal < 1) {
      return res.status(400).json({ error: "Application goal must be at least 1." });
    }

    const parsedStake = Number(stakeUsd ?? weeklyStakeUsd);
    if (!Number.isFinite(parsedStake) || parsedStake < 0) {
      return res.status(400).json({ error: "Stake must be zero or greater." });
    }

    const normalizedCycle = normalizeGoalCycle(goalCycle);
    const normalizedGoalStartDay = normalizeGoalStartDay(goalStartDay);
    if (
      normalizedCycle !== "daily" &&
      !ALLOWED_GOAL_START_DAYS.has(String(goalStartDay ?? "").trim().toLowerCase())
    ) {
      return res.status(400).json({
        error: "Goal start day is required for weekly and biweekly cycles."
      });
    }

    await pool.query(
      `
        UPDATE app_groups
        SET weekly_goal = $2,
            weekly_stake_usd = $3,
            goal_cycle = $4,
            goal_start_day = $5,
            updated_at = NOW()
        WHERE id = $1
      `,
      [
        groupId,
        Math.round(parsedGoal),
        Math.round(parsedStake),
        normalizedCycle,
        normalizedGoalStartDay
      ]
    );

    const updated = await getGroupByIdForMember(groupId, userId);
    if (!updated) {
      return res.status(404).json({ error: "Group not found." });
    }

    return res.status(200).json({ group: toGroupSummary(updated) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to update group settings."
    });
  }
});

app.post("/api/groups/:groupId/invite-code/regenerate", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    if (!groupId) {
      return res.status(400).json({ error: "Group id is required." });
    }

    const role = await getGroupMemberRole(groupId, userId);
    if (!role) {
      return res.status(404).json({ error: "Group not found." });
    }
    if (role !== "admin") {
      return res.status(403).json({ error: "Only admins can regenerate invite code." });
    }

    const newInviteCode = await createUniqueInviteCodeWithPreferred();
    const expiresAt = nowPlusInviteExpiryDate();
    const inviteExpiryValue = poolMode === "mysql" ? formatMySqlTimestamp(expiresAt) : expiresAt;

    await pool.query(
      `
        UPDATE app_groups
        SET invite_code = $2,
            invite_code_expires_at = $3,
            updated_at = NOW()
        WHERE id = $1
      `,
      [groupId, newInviteCode, inviteExpiryValue]
    );

    const updated = await getGroupByIdForMember(groupId, userId);
    if (!updated) {
      return res.status(404).json({ error: "Group not found." });
    }

    return res.status(200).json({ group: toGroupSummary(updated) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to regenerate invite code."
    });
  }
});

app.delete("/api/groups/:groupId", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    if (!groupId) {
      return res.status(400).json({ error: "Group id is required." });
    }

    const role = await getGroupMemberRole(groupId, userId);
    if (!role) {
      return res.status(404).json({ error: "Group not found." });
    }
    if (role !== "admin") {
      return res.status(403).json({ error: "Only admins can delete groups." });
    }

    const deleted = await pool.query(
      `
        DELETE FROM app_groups
        WHERE id = $1
      `,
      [groupId]
    );
    if (Number(deleted.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: "Group not found." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to delete group."
    });
  }
});

app.get("/api/groups/:groupId/activity", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    if (!groupId) {
      return res.status(400).json({ error: "Group id is required." });
    }

    const activity = await getCurrentCycleGroupActivity(groupId, userId);
    if (!activity) {
      return res.status(404).json({ error: "Group not found." });
    }

    return res.status(200).json(activity);
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch group activity."
    });
  }
});

app.patch("/api/groups/:groupId/members/:memberId/count", authMiddleware, async (req, res) => {
  try {
    const requesterUserId = req.auth?.sub;
    if (!requesterUserId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    const memberId = String(req.params.memberId ?? "").trim();
    if (!groupId || !memberId) {
      return res.status(400).json({ error: "Group id and member id are required." });
    }

    const requesterRole = await getGroupMemberRole(groupId, requesterUserId);
    if (!requesterRole) {
      return res.status(404).json({ error: "Group not found." });
    }

    const canEditTarget = requesterUserId === memberId;
    if (!canEditTarget) {
      return res.status(403).json({ error: "You can only update your own application count." });
    }

    const memberExists = await isMemberInGroup(groupId, memberId);
    if (!memberExists) {
      return res.status(404).json({ error: "Member not found in this group." });
    }

    const group = await getGroupByIdForMember(groupId, requesterUserId);
    if (!group) {
      return res.status(404).json({ error: "Group not found." });
    }

    const cycle = getCycleWindowForGroup(group, new Date());
    const hasAbsoluteCount = Number.isFinite(Number(req.body?.applicationsCount));
    const hasDelta = Number.isFinite(Number(req.body?.delta));
    if (!hasAbsoluteCount && !hasDelta) {
      return res.status(400).json({ error: "Provide either applicationsCount or delta." });
    }

    const currentValue = await getMemberCycleCount(groupId, memberId, cycle.cycleKey);
    const nextValue = hasAbsoluteCount
      ? Math.max(0, Math.floor(Number(req.body?.applicationsCount)))
      : Math.max(0, currentValue + Math.floor(Number(req.body?.delta)));

    const saved = await setMemberCycleCount(groupId, memberId, cycle.cycleKey, nextValue);

    return res.status(200).json({
      memberId,
      applicationsCount: saved,
      cycle: {
        key: cycle.cycleKey,
        label: cycle.label,
        startsAt: cycle.startsAt.toISOString(),
        endsAt: cycle.endsAt.toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to update member application count."
    });
  }
});

app.get("/api/groups/:groupId", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    if (!groupId) {
      return res.status(400).json({ error: "Group id is required." });
    }

    const group = await getGroupByIdForMember(groupId, userId);
    if (!group) {
      return res.status(404).json({ error: "Group not found." });
    }

    return res.status(200).json({ group: toGroupSummary(group) });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch group."
    });
  }
});

if (existsSync(frontendIndexFile)) {
  app.use(express.static(frontendDistDir));

  // Serve the SPA shell for non-API routes in production/container deployments.
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      return next();
    }
    return res.sendFile(frontendIndexFile);
  });
}

try {
  await initDb();
} catch (error) {
  if (poolMode === "postgres" || poolMode === "mysql") {
    const label = poolMode === "mysql" ? "MySQL" : "Postgres";
    console.warn(
      `${label} connection failed. Falling back to in-memory DB for local development.`
    );
    console.warn(error instanceof Error ? error.message : String(error));
    try {
      await pool.end();
    } catch {
      // no-op
    }
    pool = createInMemoryPool();
    poolMode = "memory";
    await initDb();
  } else {
    throw error;
  }
}

app.listen(PORT, () => {
  console.log(`Auth backend listening on http://localhost:${PORT}`);
  if (!process.env.JWT_SECRET && process.env.NODE_ENV !== "production") {
    console.warn("Using fallback development JWT secret. Set JWT_SECRET in .env for persistence.");
  }
  if (poolMode === "mysql") {
    console.log("Using MySQL auth database.");
  }
  if (poolMode === "postgres") {
    console.log("Using Postgres auth database.");
  }
  if (poolMode === "memory") {
    console.log("Using in-memory auth database (data resets on restart).");
  }
  if (!googleConfigured) {
    console.log(getGoogleOAuthNotConfiguredMessage());
  }
  if (entraConfiguredExplicitly && !entraConfigured) {
    console.log(getEntraOAuthNotConfiguredMessage());
  }
});
