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
const MAX_CHAT_MESSAGE_LENGTH = 1000;
const MAX_CHAT_REACTION_EMOJI_LENGTH = 16;
const CHAT_MESSAGE_RETENTION_DAYS = 7;
const CHAT_CLEANUP_JOB_INTERVAL_MS = 60 * 60 * 1000;
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
const GOAL_REMINDER_JOB_INTERVAL_MS = 5 * 60 * 1000;
const NOTIFICATION_DEFAULT_LIMIT = 100;
let memberCycleCountsStoreMode = "database";
const volatileMemberCycleCounts = new Map();
const notificationSseClientsByUserId = new Map();
let goalReminderJobInterval = null;
let goalReminderJobRunning = false;
let chatCleanupJobInterval = null;
let chatCleanupJobRunning = false;
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
    timezone: "Z",
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
        timezone VARCHAR(64) NOT NULL DEFAULT '${APP_TIME_ZONE}',
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

    const timezoneColumn = await pool.query(`
      SELECT COUNT(*) AS count
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = 'users'
        AND column_name = 'timezone'
    `);

    if (Number(timezoneColumn.rows[0]?.count ?? 0) === 0) {
      await pool.query(
        `ALTER TABLE users ADD COLUMN timezone VARCHAR(64) NOT NULL DEFAULT '${APP_TIME_ZONE}'`
      );
    }

    await pool.query(
      `UPDATE users SET timezone = '${APP_TIME_ZONE}' WHERE timezone IS NULL OR TRIM(timezone) = ''`
    );
    await pool.query(
      `ALTER TABLE users MODIFY COLUMN timezone VARCHAR(64) NOT NULL DEFAULT '${APP_TIME_ZONE}'`
    );

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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS member_counter_application_logs (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        group_id_snapshot VARCHAR(191) NOT NULL,
        group_name_snapshot VARCHAR(${GROUP_NAME_MAX_LENGTH}) NOT NULL,
        goal_cycle_snapshot VARCHAR(16) NOT NULL,
        goal_start_day_snapshot VARCHAR(16) NOT NULL,
        application_goal_snapshot INT NOT NULL,
        stake_usd_snapshot INT NOT NULL,
        cycle_key_snapshot VARCHAR(64) NOT NULL,
        cycle_label_snapshot VARCHAR(16) NOT NULL,
        cycle_starts_at TIMESTAMP NOT NULL,
        cycle_ends_at TIMESTAMP NOT NULL,
        application_index INT NOT NULL,
        logged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS member_settlement_logs (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        group_id_snapshot VARCHAR(191) NOT NULL,
        group_name_snapshot VARCHAR(${GROUP_NAME_MAX_LENGTH}) NOT NULL,
        goal_cycle_snapshot VARCHAR(16) NOT NULL,
        goal_start_day_snapshot VARCHAR(16) NOT NULL,
        application_goal_snapshot INT NOT NULL,
        stake_usd_snapshot INT NOT NULL,
        cycle_key_snapshot VARCHAR(64) NOT NULL,
        cycle_label_snapshot VARCHAR(16) NOT NULL,
        cycle_starts_at TIMESTAMP NOT NULL,
        cycle_ends_at TIMESTAMP NOT NULL,
        settled_at TIMESTAMP NOT NULL,
        participant_count INT NOT NULL,
        qualified_participant_count INT NOT NULL,
        pot_value_cents_snapshot INT NOT NULL,
        amount_won_cents INT NOT NULL,
        applications_count_snapshot INT NOT NULL,
        met_goal_snapshot BOOLEAN NOT NULL,
        participants_snapshot_json LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY member_settlement_logs_user_group_cycle_uidx (user_id, group_id_snapshot, cycle_key_snapshot),
        KEY member_settlement_logs_user_settled_idx (user_id, settled_at),
        KEY member_settlement_logs_group_cycle_idx (group_id_snapshot, cycle_key_snapshot)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_notifications (
        id VARCHAR(191) PRIMARY KEY,
        user_id VARCHAR(191) NOT NULL,
        group_id VARCHAR(191) NULL,
        notification_type VARCHAR(64) NOT NULL,
        title VARCHAR(191) NOT NULL,
        message TEXT NOT NULL,
        payload_json LONGTEXT NULL,
        dedupe_key VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP NULL DEFAULT NULL,
        CONSTRAINT fk_app_notifications_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_app_notifications_group
          FOREIGN KEY (group_id) REFERENCES app_groups(id) ON DELETE SET NULL,
        UNIQUE KEY app_notifications_user_dedupe_uidx (user_id, dedupe_key),
        KEY app_notifications_user_created_idx (user_id, created_at),
        KEY app_notifications_user_read_idx (user_id, read_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_chat_messages (
        id VARCHAR(191) PRIMARY KEY,
        group_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        body TEXT NOT NULL,
        reply_to_message_id VARCHAR(191) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_group_chat_messages_group
          FOREIGN KEY (group_id) REFERENCES app_groups(id) ON DELETE CASCADE,
        CONSTRAINT fk_group_chat_messages_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        CONSTRAINT fk_group_chat_messages_reply
          FOREIGN KEY (reply_to_message_id) REFERENCES group_chat_messages(id) ON DELETE SET NULL,
        KEY group_chat_messages_group_created_idx (group_id, created_at),
        KEY group_chat_messages_reply_idx (reply_to_message_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS group_chat_message_reactions (
        message_id VARCHAR(191) NOT NULL,
        user_id VARCHAR(191) NOT NULL,
        emoji VARCHAR(32) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (message_id, user_id, emoji),
        CONSTRAINT fk_group_chat_reactions_message
          FOREIGN KEY (message_id) REFERENCES group_chat_messages(id) ON DELETE CASCADE,
        CONSTRAINT fk_group_chat_reactions_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        KEY group_chat_reactions_message_idx (message_id),
        KEY group_chat_reactions_user_idx (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS app_notification_dismissals (
        user_id VARCHAR(191) NOT NULL,
        dedupe_key VARCHAR(255) NOT NULL,
        dismissed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, dedupe_key),
        CONSTRAINT fk_app_notification_dismissals_user
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

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
      timezone TEXT NOT NULL DEFAULT '${APP_TIME_ZONE}',
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
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS timezone TEXT;
  `);

  await pool.query(
    `UPDATE users SET timezone = '${APP_TIME_ZONE}' WHERE timezone IS NULL OR BTRIM(timezone) = ''`
  );
  await pool.query(
    `ALTER TABLE users ALTER COLUMN timezone SET DEFAULT '${APP_TIME_ZONE}'`
  );
  await pool.query(`
    ALTER TABLE users
    ALTER COLUMN timezone SET NOT NULL;
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
    CREATE TABLE IF NOT EXISTS member_counter_application_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id_snapshot TEXT NOT NULL,
      group_name_snapshot TEXT NOT NULL,
      goal_cycle_snapshot TEXT NOT NULL,
      goal_start_day_snapshot TEXT NOT NULL,
      application_goal_snapshot INT NOT NULL,
      stake_usd_snapshot INT NOT NULL,
      cycle_key_snapshot TEXT NOT NULL,
      cycle_label_snapshot TEXT NOT NULL,
      cycle_starts_at TIMESTAMPTZ NOT NULL,
      cycle_ends_at TIMESTAMPTZ NOT NULL,
      application_index INT NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS member_settlement_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      group_id_snapshot TEXT NOT NULL,
      group_name_snapshot TEXT NOT NULL,
      goal_cycle_snapshot TEXT NOT NULL,
      goal_start_day_snapshot TEXT NOT NULL,
      application_goal_snapshot INT NOT NULL,
      stake_usd_snapshot INT NOT NULL,
      cycle_key_snapshot TEXT NOT NULL,
      cycle_label_snapshot TEXT NOT NULL,
      cycle_starts_at TIMESTAMPTZ NOT NULL,
      cycle_ends_at TIMESTAMPTZ NOT NULL,
      settled_at TIMESTAMPTZ NOT NULL,
      participant_count INT NOT NULL,
      qualified_participant_count INT NOT NULL,
      pot_value_cents_snapshot INT NOT NULL,
      amount_won_cents INT NOT NULL,
      applications_count_snapshot INT NOT NULL,
      met_goal_snapshot BOOLEAN NOT NULL,
      participants_snapshot_json TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      group_id TEXT REFERENCES app_groups(id) ON DELETE SET NULL,
      notification_type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      payload_json TEXT,
      dedupe_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      read_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_notification_dismissals (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dedupe_key TEXT NOT NULL,
      dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, dedupe_key)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_chat_messages (
      id TEXT PRIMARY KEY,
      group_id TEXT NOT NULL REFERENCES app_groups(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      reply_to_message_id TEXT REFERENCES group_chat_messages(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS group_chat_message_reactions (
      message_id TEXT NOT NULL REFERENCES group_chat_messages(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      emoji TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (message_id, user_id, emoji)
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS group_members_user_idx
    ON group_members(user_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS group_invites_recipient_status_idx
    ON group_invites(recipient_email, status);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS member_counter_application_logs_user_logged_idx
    ON member_counter_application_logs(user_id, logged_at DESC);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS member_settlement_logs_user_group_cycle_uidx
    ON member_settlement_logs(user_id, group_id_snapshot, cycle_key_snapshot);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS member_settlement_logs_user_settled_idx
    ON member_settlement_logs(user_id, settled_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS member_settlement_logs_group_cycle_idx
    ON member_settlement_logs(group_id_snapshot, cycle_key_snapshot);
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS app_notifications_user_dedupe_uidx
    ON app_notifications(user_id, dedupe_key);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS app_notifications_user_created_idx
    ON app_notifications(user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS app_notifications_user_read_idx
    ON app_notifications(user_id, read_at);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS group_chat_messages_group_created_idx
    ON group_chat_messages(group_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS group_chat_messages_reply_idx
    ON group_chat_messages(reply_to_message_id);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS group_chat_reactions_message_idx
    ON group_chat_message_reactions(message_id);
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

function isValidTimeZone(value) {
  if (typeof value !== "string") {
    return false;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: trimmed }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function normalizeUserTimeZone(value, fallback = APP_TIME_ZONE) {
  if (!isValidTimeZone(value)) {
    return fallback;
  }
  return String(value).trim();
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

function normalizeChatMessageBody(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

function normalizeChatReactionEmoji(value) {
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CHAT_REACTION_EMOJI_LENGTH) {
    return "";
  }
  if (/\s/.test(trimmed)) {
    return "";
  }
  return trimmed;
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
      timezone: normalizeUserTimeZone(user.timezone),
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

function toCounterApplicationLog(row) {
  const goalCycle = normalizeGoalCycle(row.goal_cycle_snapshot);
  const goalStartDay = normalizeGoalStartDay(row.goal_start_day_snapshot);
  const cycleLabel =
    row.cycle_label_snapshot === "day" || row.cycle_label_snapshot === "biweekly"
      ? row.cycle_label_snapshot
      : "week";

  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    groupId: String(row.group_id_snapshot ?? ""),
    groupName: String(row.group_name_snapshot ?? ""),
    goalCycle,
    goalStartDay,
    applicationGoal: Math.max(0, Number(row.application_goal_snapshot ?? 0)),
    stakeUsd: Math.max(0, Number(row.stake_usd_snapshot ?? 0)),
    cycleKey: String(row.cycle_key_snapshot ?? ""),
    cycleLabel,
    cycleStartsAt: asIsoTimestamp(row.cycle_starts_at),
    cycleEndsAt: asIsoTimestamp(row.cycle_ends_at),
    applicationIndex: Math.max(0, Number(row.application_index ?? 0)),
    loggedAt: asIsoTimestamp(row.logged_at)
  };
}

function parseSettlementParticipantsSnapshot(value) {
  if (typeof value !== "string" || !value.trim()) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.map((entry) => ({
      userId: String(entry?.userId ?? ""),
      name: String(entry?.name ?? ""),
      email: String(entry?.email ?? ""),
      applicationsCount: Math.max(0, Number(entry?.applicationsCount ?? 0)),
      metGoal: Boolean(entry?.metGoal),
      amountWonCents: Math.max(0, Number(entry?.amountWonCents ?? 0))
    }));
  } catch {
    return [];
  }
}

function toSettlementLog(row) {
  const goalCycle = normalizeGoalCycle(row.goal_cycle_snapshot);
  const goalStartDay = normalizeGoalStartDay(row.goal_start_day_snapshot);
  const cycleLabel =
    row.cycle_label_snapshot === "day" || row.cycle_label_snapshot === "biweekly"
      ? row.cycle_label_snapshot
      : "week";

  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    groupId: String(row.group_id_snapshot ?? ""),
    groupName: String(row.group_name_snapshot ?? ""),
    goalCycle,
    goalStartDay,
    applicationGoal: Math.max(0, Number(row.application_goal_snapshot ?? 0)),
    stakeUsd: Math.max(0, Number(row.stake_usd_snapshot ?? 0)),
    cycleKey: String(row.cycle_key_snapshot ?? ""),
    cycleLabel,
    cycleStartsAt: asIsoTimestamp(row.cycle_starts_at),
    cycleEndsAt: asIsoTimestamp(row.cycle_ends_at),
    settledAt: asIsoTimestamp(row.settled_at),
    participantCount: Math.max(0, Number(row.participant_count ?? 0)),
    qualifiedParticipantCount: Math.max(0, Number(row.qualified_participant_count ?? 0)),
    potValueCents: Math.max(0, Number(row.pot_value_cents_snapshot ?? 0)),
    amountWonCents: Math.max(0, Number(row.amount_won_cents ?? 0)),
    applicationsCount: Math.max(0, Number(row.applications_count_snapshot ?? 0)),
    metGoal: Boolean(row.met_goal_snapshot),
    participants: parseSettlementParticipantsSnapshot(row.participants_snapshot_json)
  };
}

function buildDisplayNameFromColumns(firstNameValue, lastNameValue, emailValue, fallback = "Member") {
  const firstName = String(firstNameValue ?? "").trim();
  const lastName = String(lastNameValue ?? "").trim();
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) {
    return fullName;
  }
  const email = String(emailValue ?? "").trim();
  if (email) {
    return email;
  }
  return fallback;
}

function toGroupChatMessage(row, reactions = []) {
  const replyToMessageId = row.reply_to_message_id ? String(row.reply_to_message_id) : null;
  const replyToId = row.reply_id ? String(row.reply_id) : replyToMessageId;
  const replyBody = String(row.reply_body ?? "").trim();
  const replyTo =
    replyToId && replyBody
      ? {
          id: replyToId,
          body: replyBody,
          senderName: buildDisplayNameFromColumns(
            row.reply_sender_first_name,
            row.reply_sender_last_name,
            row.reply_sender_email,
            "Member"
          )
        }
      : null;

  return {
    id: String(row.id ?? ""),
    groupId: String(row.group_id ?? ""),
    userId: String(row.user_id ?? ""),
    body: String(row.body ?? ""),
    createdAt: asIsoTimestamp(row.created_at),
    replyToMessageId,
    replyTo,
    sender: {
      userId: String(row.user_id ?? ""),
      name: buildDisplayNameFromColumns(
        row.sender_first_name,
        row.sender_last_name,
        row.sender_email,
        "Member"
      ),
      avatarUrl: row.sender_avatar_url ?? null
    },
    reactions
  };
}

function parseNotificationPayload(value) {
  if (!value) {
    return null;
  }
  if (typeof value === "object") {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function toAppNotification(row) {
  const readAt = row.read_at ? asIsoTimestamp(row.read_at) : null;
  const createdAt = asIsoTimestamp(row.created_at);
  return {
    id: String(row.id ?? ""),
    userId: String(row.user_id ?? ""),
    groupId: row.group_id ? String(row.group_id) : null,
    type: String(row.notification_type ?? ""),
    title: String(row.title ?? ""),
    message: String(row.message ?? ""),
    payload: parseNotificationPayload(row.payload_json),
    createdAt,
    readAt,
    isRead: Boolean(readAt)
  };
}

function safeJsonStringify(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function writeSseEvent(res, event, payload) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${safeJsonStringify(payload)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function addNotificationSseClient(userId, res) {
  const userKey = String(userId ?? "").trim();
  if (!userKey) {
    return () => {};
  }

  const existing = notificationSseClientsByUserId.get(userKey);
  if (existing) {
    existing.add(res);
  } else {
    notificationSseClientsByUserId.set(userKey, new Set([res]));
  }

  return () => {
    const clients = notificationSseClientsByUserId.get(userKey);
    if (!clients) {
      return;
    }
    clients.delete(res);
    if (clients.size === 0) {
      notificationSseClientsByUserId.delete(userKey);
    }
  };
}

function emitNotificationCreated(notification) {
  const userId = String(notification?.userId ?? "").trim();
  if (!userId) {
    return;
  }

  const clients = notificationSseClientsByUserId.get(userId);
  if (!clients?.size) {
    return;
  }

  for (const client of [...clients]) {
    const written = writeSseEvent(client, "notification", notification);
    if (!written) {
      clients.delete(client);
    }
  }

  if (clients.size === 0) {
    notificationSseClientsByUserId.delete(userId);
  }
}

function settlementHasMultipleUniqueParticipants(log) {
  if (Array.isArray(log.participants) && log.participants.length > 0) {
    const uniqueIds = new Set(
      log.participants
        .map((participant) => String(participant?.userId ?? "").trim())
        .filter((userId) => userId.length > 0)
    );
    return uniqueIds.size > 1;
  }

  return Math.max(0, Number(log.participantCount ?? 0)) > 1;
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

function normalizeGroupChatLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) {
    return 200;
  }
  return Math.max(1, Math.min(400, Math.floor(parsed)));
}

async function getGroupChatMessageById(groupId, messageId) {
  const cutoff = chatRetentionCutoff(new Date());
  const result = await pool.query(
    `
      SELECT
        m.id,
        m.group_id,
        m.user_id,
        m.body,
        m.reply_to_message_id,
        m.created_at,
        sender.first_name AS sender_first_name,
        sender.last_name AS sender_last_name,
        sender.email AS sender_email,
        sender.avatar_url AS sender_avatar_url,
        reply.id AS reply_id,
        reply.body AS reply_body,
        reply_sender.first_name AS reply_sender_first_name,
        reply_sender.last_name AS reply_sender_last_name,
        reply_sender.email AS reply_sender_email
      FROM group_chat_messages m
      INNER JOIN users sender
        ON sender.id = m.user_id
      LEFT JOIN group_chat_messages reply
        ON reply.id = m.reply_to_message_id
      LEFT JOIN users reply_sender
        ON reply_sender.id = reply.user_id
      WHERE m.group_id = $1
        AND m.id = $2
        AND m.created_at >= $3
      LIMIT 1
    `,
    [groupId, messageId, cutoff]
  );

  return result.rows[0] ?? null;
}

async function getChatReactionsByMessageIds(messageIds, currentUserId) {
  if (!Array.isArray(messageIds) || !messageIds.length) {
    return new Map();
  }

  const placeholders = messageIds.map((_, index) => `$${index + 1}`).join(", ");
  const result = await pool.query(
    `
      SELECT
        message_id,
        user_id,
        emoji
      FROM group_chat_message_reactions
      WHERE message_id IN (${placeholders})
    `,
    messageIds
  );

  const grouped = new Map();
  for (const row of result.rows) {
    const messageId = String(row.message_id ?? "");
    const emoji = String(row.emoji ?? "");
    if (!messageId || !emoji) {
      continue;
    }
    if (!grouped.has(messageId)) {
      grouped.set(messageId, new Map());
    }
    const byEmoji = grouped.get(messageId);
    const bucket = byEmoji.get(emoji) ?? { emoji, count: 0, reactedByCurrentUser: false };
    bucket.count += 1;
    if (String(row.user_id ?? "") === currentUserId) {
      bucket.reactedByCurrentUser = true;
    }
    byEmoji.set(emoji, bucket);
  }

  const reactionsByMessageId = new Map();
  for (const [messageId, byEmoji] of grouped.entries()) {
    const reactions = [...byEmoji.values()].sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }
      return left.emoji.localeCompare(right.emoji);
    });
    reactionsByMessageId.set(messageId, reactions);
  }

  return reactionsByMessageId;
}

async function listGroupChatMessages(groupId, currentUserId, limit = 200) {
  const safeLimit = normalizeGroupChatLimit(limit);
  const cutoff = chatRetentionCutoff(new Date());
  const result = await pool.query(
    `
      SELECT
        m.id,
        m.group_id,
        m.user_id,
        m.body,
        m.reply_to_message_id,
        m.created_at,
        sender.first_name AS sender_first_name,
        sender.last_name AS sender_last_name,
        sender.email AS sender_email,
        sender.avatar_url AS sender_avatar_url,
        reply.id AS reply_id,
        reply.body AS reply_body,
        reply_sender.first_name AS reply_sender_first_name,
        reply_sender.last_name AS reply_sender_last_name,
        reply_sender.email AS reply_sender_email
      FROM group_chat_messages m
      INNER JOIN users sender
        ON sender.id = m.user_id
      LEFT JOIN group_chat_messages reply
        ON reply.id = m.reply_to_message_id
      LEFT JOIN users reply_sender
        ON reply_sender.id = reply.user_id
      WHERE m.group_id = $1
        AND m.created_at >= $2
      ORDER BY m.created_at DESC, m.id DESC
      LIMIT $3
    `,
    [groupId, cutoff, safeLimit]
  );

  const rowsNewestFirst = result.rows;
  const rows = [...rowsNewestFirst].reverse();
  const messageIds = rows.map((row) => String(row.id ?? "")).filter((id) => id.length > 0);
  const reactionsByMessageId = await getChatReactionsByMessageIds(messageIds, currentUserId);

  return rows.map((row) =>
    toGroupChatMessage(row, reactionsByMessageId.get(String(row.id ?? "")) ?? [])
  );
}

async function createGroupChatMessage({
  groupId,
  userId,
  body,
  replyToMessageId = null
}) {
  const normalizedBody = normalizeChatMessageBody(body);
  if (!normalizedBody) {
    throw new HttpError(400, "Message cannot be empty.");
  }
  if (normalizedBody.length > MAX_CHAT_MESSAGE_LENGTH) {
    throw new HttpError(400, `Message cannot exceed ${MAX_CHAT_MESSAGE_LENGTH} characters.`);
  }

  let normalizedReplyToMessageId = null;
  if (replyToMessageId) {
    normalizedReplyToMessageId = String(replyToMessageId).trim();
    if (!normalizedReplyToMessageId) {
      normalizedReplyToMessageId = null;
    }
  }

  if (normalizedReplyToMessageId) {
    const replyTarget = await getGroupChatMessageById(groupId, normalizedReplyToMessageId);
    if (!replyTarget) {
      throw new HttpError(404, "Reply target message not found.");
    }
  }

  const messageId = randomUUID();
  await pool.query(
    `
      INSERT INTO group_chat_messages (
        id,
        group_id,
        user_id,
        body,
        reply_to_message_id
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [messageId, groupId, userId, normalizedBody, normalizedReplyToMessageId]
  );

  const created = await getGroupChatMessageById(groupId, messageId);
  if (!created) {
    throw new Error("Unable to load created chat message.");
  }

  return toGroupChatMessage(created, []);
}

async function toggleGroupChatReaction({ groupId, messageId, userId, emoji }) {
  const normalizedEmoji = normalizeChatReactionEmoji(emoji);
  if (!normalizedEmoji) {
    throw new HttpError(400, "Emoji is required.");
  }

  const message = await getGroupChatMessageById(groupId, messageId);
  if (!message) {
    throw new HttpError(404, "Message not found.");
  }

  const existing = await pool.query(
    `
      SELECT 1
      FROM group_chat_message_reactions
      WHERE message_id = $1
        AND user_id = $2
        AND emoji = $3
      LIMIT 1
    `,
    [messageId, userId, normalizedEmoji]
  );

  if (existing.rows.length) {
    await pool.query(
      `
        DELETE FROM group_chat_message_reactions
        WHERE message_id = $1
          AND user_id = $2
          AND emoji = $3
      `,
      [messageId, userId, normalizedEmoji]
    );
    return { messageId, emoji: normalizedEmoji, reacted: false };
  }

  await pool.query(
    `
      INSERT INTO group_chat_message_reactions (
        message_id,
        user_id,
        emoji
      )
      VALUES ($1, $2, $3)
    `,
    [messageId, userId, normalizedEmoji]
  );

  return { messageId, emoji: normalizedEmoji, reacted: true };
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

async function appendCounterApplicationLogs({
  userId,
  group,
  cycle,
  fromExclusive,
  toInclusive
}) {
  const startValue = Math.max(0, Math.floor(Number(fromExclusive) || 0));
  const endValue = Math.max(0, Math.floor(Number(toInclusive) || 0));
  if (endValue <= startValue) {
    return [];
  }

  const goalCycle = normalizeGoalCycle(group.goal_cycle);
  const goalStartDay = normalizeGoalStartDay(group.goal_start_day);
  const goalAtLogTime = Math.max(0, Number(group.weekly_goal ?? 0));
  const stakeAtLogTime = Math.max(0, Number(group.weekly_stake_usd ?? 0));
  const cycleStartsAt = asIsoTimestamp(cycle.startsAt);
  const cycleEndsAt = asIsoTimestamp(cycle.endsAt);
  const loggedAt = new Date().toISOString();
  const inserted = [];

  for (let index = startValue + 1; index <= endValue; index += 1) {
    const id = randomUUID();
    await pool.query(
      `
        INSERT INTO member_counter_application_logs (
          id,
          user_id,
          group_id_snapshot,
          group_name_snapshot,
          goal_cycle_snapshot,
          goal_start_day_snapshot,
          application_goal_snapshot,
          stake_usd_snapshot,
          cycle_key_snapshot,
          cycle_label_snapshot,
          cycle_starts_at,
          cycle_ends_at,
          application_index,
          logged_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        id,
        userId,
        group.id,
        group.name,
        goalCycle,
        goalStartDay,
        goalAtLogTime,
        stakeAtLogTime,
        cycle.cycleKey,
        cycle.label,
        cycleStartsAt,
        cycleEndsAt,
        index,
        loggedAt
      ]
    );
    inserted.push({
      id,
      user_id: userId,
      group_id_snapshot: group.id,
      group_name_snapshot: group.name,
      goal_cycle_snapshot: goalCycle,
      goal_start_day_snapshot: goalStartDay,
      application_goal_snapshot: goalAtLogTime,
      stake_usd_snapshot: stakeAtLogTime,
      cycle_key_snapshot: cycle.cycleKey,
      cycle_label_snapshot: cycle.label,
      cycle_starts_at: cycleStartsAt,
      cycle_ends_at: cycleEndsAt,
      application_index: index,
      logged_at: loggedAt
    });
  }

  return inserted.map((row) => toCounterApplicationLog(row));
}

async function listCounterApplicationLogsForUser(userId, limit = 500) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
  const result = await pool.query(
    `
      SELECT
        id,
        user_id,
        group_id_snapshot,
        group_name_snapshot,
        goal_cycle_snapshot,
        goal_start_day_snapshot,
        application_goal_snapshot,
        stake_usd_snapshot,
        cycle_key_snapshot,
        cycle_label_snapshot,
        cycle_starts_at,
        cycle_ends_at,
        application_index,
        logged_at
      FROM member_counter_application_logs
      WHERE user_id = $1
      ORDER BY logged_at DESC, application_index DESC
      LIMIT $2
    `,
    [userId, safeLimit]
  );
  return result.rows.map((row) => toCounterApplicationLog(row));
}

async function removeRecentCounterApplicationLogs({
  userId,
  groupId,
  cycleKey,
  count
}) {
  const removalCount = Math.max(0, Math.floor(Number(count) || 0));
  if (removalCount <= 0) {
    return 0;
  }

  const toDelete = await pool.query(
    `
      SELECT id
      FROM member_counter_application_logs
      WHERE user_id = $1
        AND group_id_snapshot = $2
        AND cycle_key_snapshot = $3
      ORDER BY logged_at DESC, application_index DESC
      LIMIT $4
    `,
    [userId, groupId, cycleKey, removalCount]
  );

  const ids = toDelete.rows
    .map((row) => String(row.id ?? "").trim())
    .filter((value) => value.length > 0);

  for (const id of ids) {
    await pool.query(
      `
        DELETE FROM member_counter_application_logs
        WHERE id = $1
      `,
      [id]
    );
  }

  return ids.length;
}

function listVolatileCycleKeysForGroup(groupId) {
  const keys = new Set();
  const prefix = `${groupId}:`;

  for (const key of volatileMemberCycleCounts.keys()) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    const remainder = key.slice(prefix.length);
    const separatorIndex = remainder.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    const cycleKey = remainder.slice(0, separatorIndex).trim();
    if (cycleKey) {
      keys.add(cycleKey);
    }
  }

  return [...keys];
}

async function listCycleKeysForGroup(groupId) {
  if (memberCycleCountsStoreMode !== "database") {
    return listVolatileCycleKeysForGroup(groupId);
  }

  try {
    const result = await pool.query(
      `
        SELECT DISTINCT cycle_key
        FROM group_member_cycle_counts
        WHERE group_id = $1
      `,
      [groupId]
    );

    return result.rows
      .map((row) => String(row.cycle_key ?? "").trim())
      .filter((cycleKey) => cycleKey.length > 0);
  } catch (error) {
    disablePersistentMemberCycleCounts(error);
    return listVolatileCycleKeysForGroup(groupId);
  }
}

function cycleWindowFromCycleKey(cycleKey) {
  const match = /^(daily|weekly|biweekly)-(\d{4})-(\d{2})-(\d{2})$/.exec(
    String(cycleKey ?? "").trim()
  );
  if (!match) {
    return null;
  }

  const goalCycle = match[1];
  const year = Number(match[2]);
  const month = Number(match[3]);
  const day = Number(match[4]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const startsAtLocal = new Date(Date.UTC(year, month - 1, day));
  const durationDays = goalCycle === "daily" ? 1 : goalCycle === "biweekly" ? 14 : 7;
  const endsAtLocal = addUtcCalendarDays(startsAtLocal, durationDays);
  const startsAt = zonedLocalToUtc(
    startsAtLocal.getUTCFullYear(),
    startsAtLocal.getUTCMonth() + 1,
    startsAtLocal.getUTCDate(),
    0,
    0,
    0,
    APP_TIME_ZONE
  );
  const endsAt = zonedLocalToUtc(
    endsAtLocal.getUTCFullYear(),
    endsAtLocal.getUTCMonth() + 1,
    endsAtLocal.getUTCDate(),
    0,
    0,
    0,
    APP_TIME_ZONE
  );

  return {
    goalCycle,
    label: cycleLabelForGoalCycle(goalCycle),
    startsAt,
    endsAt,
    cycleKey: `${goalCycle}-${match[2]}-${match[3]}-${match[4]}`
  };
}

function settlementTimestampForCycleEnd(cycleEndsAt) {
  const cycleEndCalendar = toUtcCalendarDate(cycleEndsAt, APP_TIME_ZONE);
  return zonedLocalToUtc(
    cycleEndCalendar.getUTCFullYear(),
    cycleEndCalendar.getUTCMonth() + 1,
    cycleEndCalendar.getUTCDate(),
    12,
    0,
    0,
    APP_TIME_ZONE
  );
}

function memberDisplayName(row) {
  const firstName = String(row.first_name ?? "").trim();
  const lastName = String(row.last_name ?? "").trim();
  return [firstName, lastName].filter(Boolean).join(" ").trim() || String(row.email ?? "Member");
}

function isDuplicateInsertError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("duplicate") ||
    message.includes("already exists") ||
    message.includes("unique constraint")
  );
}

async function hasSettlementLogsForGroupCycle(groupId, cycleKey) {
  const result = await pool.query(
    `
      SELECT 1
      FROM member_settlement_logs
      WHERE group_id_snapshot = $1
        AND cycle_key_snapshot = $2
      LIMIT 1
    `,
    [groupId, cycleKey]
  );
  return result.rows.length > 0;
}

function buildPayoutMap(participants, stakeCents) {
  const eligible = participants.filter((participant) => participant.metGoal);
  const payoutTargets = eligible.length ? eligible : participants;
  const totalPotCents = Math.max(0, participants.length * stakeCents);
  const sortedTargets = [...payoutTargets].sort((left, right) =>
    left.userId.localeCompare(right.userId)
  );

  const payoutMap = new Map();
  if (!sortedTargets.length || totalPotCents <= 0) {
    return {
      payoutMap,
      qualifiedCount: eligible.length,
      totalPotCents
    };
  }

  const baseShare = Math.floor(totalPotCents / sortedTargets.length);
  let remainder = totalPotCents % sortedTargets.length;
  for (const target of sortedTargets) {
    const payout = baseShare + (remainder > 0 ? 1 : 0);
    if (remainder > 0) {
      remainder -= 1;
    }
    payoutMap.set(target.userId, payout);
  }

  return {
    payoutMap,
    qualifiedCount: eligible.length,
    totalPotCents
  };
}

async function appendSettlementLogsForGroupCycle(group, cycleWindow) {
  const existing = await hasSettlementLogsForGroupCycle(group.id, cycleWindow.cycleKey);
  if (existing) {
    return 0;
  }

  const settledAt = settlementTimestampForCycleEnd(cycleWindow.endsAt);
  if (Date.now() < settledAt.getTime()) {
    return 0;
  }

  const members = await getGroupMembersWithProfiles(group.id);
  if (members.length <= 1) {
    return 0;
  }

  const goalCycle = normalizeGoalCycle(group.goal_cycle);
  const goalStartDay = normalizeGoalStartDay(group.goal_start_day);
  const applicationGoal = Math.max(0, Number(group.weekly_goal ?? 0));
  const stakeUsd = Math.max(0, Number(group.weekly_stake_usd ?? 0));
  const stakeCents = Math.max(0, Math.round(stakeUsd * 100));
  const countsByUserId = await getCycleCountsForGroup(group.id, cycleWindow.cycleKey);

  const participantSnapshots = members.map((member) => {
    const applicationsCount = countsByUserId.get(String(member.user_id)) ?? 0;
    const metGoal = applicationGoal <= 0 ? true : applicationsCount >= applicationGoal;

    return {
      userId: String(member.user_id),
      name: memberDisplayName(member),
      email: String(member.email ?? ""),
      applicationsCount: Math.max(0, Number(applicationsCount ?? 0)),
      metGoal
    };
  });

  const { payoutMap, qualifiedCount, totalPotCents } = buildPayoutMap(
    participantSnapshots,
    stakeCents
  );
  const participantSnapshotsWithPayout = participantSnapshots.map((participant) => ({
    ...participant,
    amountWonCents: Math.max(0, Number(payoutMap.get(participant.userId) ?? 0))
  }));
  const participantsSnapshotJson = JSON.stringify(participantSnapshotsWithPayout);
  const cycleStartsAt = cycleWindow.startsAt.toISOString();
  const cycleEndsAt = cycleWindow.endsAt.toISOString();
  const settledAtIso = settledAt.toISOString();
  let inserted = 0;

  for (const participant of participantSnapshotsWithPayout) {
    const rowId = randomUUID();
    try {
      await pool.query(
        `
          INSERT INTO member_settlement_logs (
            id,
            user_id,
            group_id_snapshot,
            group_name_snapshot,
            goal_cycle_snapshot,
            goal_start_day_snapshot,
            application_goal_snapshot,
            stake_usd_snapshot,
            cycle_key_snapshot,
            cycle_label_snapshot,
            cycle_starts_at,
            cycle_ends_at,
            settled_at,
            participant_count,
            qualified_participant_count,
            pot_value_cents_snapshot,
            amount_won_cents,
            applications_count_snapshot,
            met_goal_snapshot,
            participants_snapshot_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
        `,
        [
          rowId,
          participant.userId,
          group.id,
          group.name,
          goalCycle,
          goalStartDay,
          applicationGoal,
          stakeUsd,
          cycleWindow.cycleKey,
          cycleWindow.label,
          cycleStartsAt,
          cycleEndsAt,
          settledAtIso,
          participantSnapshotsWithPayout.length,
          qualifiedCount,
          totalPotCents,
          participant.amountWonCents,
          participant.applicationsCount,
          participant.metGoal,
          participantsSnapshotJson
        ]
      );
      inserted += 1;
    } catch (error) {
      if (!isDuplicateInsertError(error)) {
        throw error;
      }
    }
  }

  return inserted;
}

async function ensureSettlementLogsForGroup(group) {
  const cycleKeys = await listCycleKeysForGroup(group.id);
  if (!cycleKeys.length) {
    return 0;
  }

  const parsed = cycleKeys
    .map((cycleKey) => cycleWindowFromCycleKey(cycleKey))
    .filter((window) => window !== null)
    .sort((left, right) => left.startsAt.getTime() - right.startsAt.getTime());

  let inserted = 0;
  for (const cycleWindow of parsed) {
    inserted += await appendSettlementLogsForGroupCycle(group, cycleWindow);
  }
  return inserted;
}

async function ensureSettlementLogsForUser(userId) {
  const result = await pool.query(
    `
      SELECT g.*
      FROM app_groups g
      INNER JOIN group_members gm
        ON gm.group_id = g.id
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
    `,
    [userId]
  );

  for (const group of result.rows) {
    await ensureSettlementLogsForGroup(group);
  }
}

async function listSettlementLogsForUser(userId, limit = 500) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 500));
  const result = await pool.query(
    `
      SELECT
        id,
        user_id,
        group_id_snapshot,
        group_name_snapshot,
        goal_cycle_snapshot,
        goal_start_day_snapshot,
        application_goal_snapshot,
        stake_usd_snapshot,
        cycle_key_snapshot,
        cycle_label_snapshot,
        cycle_starts_at,
        cycle_ends_at,
        settled_at,
        participant_count,
        qualified_participant_count,
        pot_value_cents_snapshot,
        amount_won_cents,
        applications_count_snapshot,
        met_goal_snapshot,
        participants_snapshot_json
      FROM member_settlement_logs
      WHERE user_id = $1
        AND participant_count > 1
      ORDER BY settled_at DESC, created_at DESC
      LIMIT $2
    `,
    [userId, safeLimit]
  );

  return result.rows
    .map((row) => toSettlementLog(row))
    .filter((entry) => settlementHasMultipleUniqueParticipants(entry));
}

async function getNotificationById(notificationId) {
  const result = await pool.query(
    `
      SELECT
        id,
        user_id,
        group_id,
        notification_type,
        title,
        message,
        payload_json,
        dedupe_key,
        created_at,
        read_at
      FROM app_notifications
      WHERE id = $1
      LIMIT 1
    `,
    [notificationId]
  );

  const row = result.rows[0] ?? null;
  return row ? toAppNotification(row) : null;
}

async function isNotificationDedupeDismissed(userId, dedupeKey) {
  const normalizedDedupeKey = String(dedupeKey ?? "").trim();
  if (!userId || !normalizedDedupeKey) {
    return false;
  }

  const result = await pool.query(
    `
      SELECT 1
      FROM app_notification_dismissals
      WHERE user_id = $1
        AND dedupe_key = $2
      LIMIT 1
    `,
    [userId, normalizedDedupeKey]
  );

  return result.rows.length > 0;
}

async function recordNotificationDismissal(userId, dedupeKey) {
  const normalizedDedupeKey = String(dedupeKey ?? "").trim();
  if (!userId || !normalizedDedupeKey) {
    return;
  }

  try {
    await pool.query(
      `
        INSERT INTO app_notification_dismissals (
          user_id,
          dedupe_key,
          dismissed_at
        )
        VALUES ($1, $2, NOW())
      `,
      [userId, normalizedDedupeKey]
    );
  } catch (error) {
    if (!isDuplicateInsertError(error)) {
      throw error;
    }
  }
}

async function createNotification({
  userId,
  groupId = null,
  type,
  title,
  message,
  payload = null,
  dedupeKey = null
}) {
  if (!userId || !type || !title || !message) {
    return null;
  }

  const notificationId = randomUUID();
  const payloadJson = payload ? JSON.stringify(payload) : null;
  const normalizedDedupeKey = dedupeKey ? String(dedupeKey).trim() : null;
  if (normalizedDedupeKey) {
    const dismissed = await isNotificationDedupeDismissed(userId, normalizedDedupeKey);
    if (dismissed) {
      return null;
    }
  }

  try {
    await pool.query(
      `
        INSERT INTO app_notifications (
          id,
          user_id,
          group_id,
          notification_type,
          title,
          message,
          payload_json,
          dedupe_key
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
      [
        notificationId,
        userId,
        groupId,
        type,
        title,
        message,
        payloadJson,
        normalizedDedupeKey
      ]
    );
  } catch (error) {
    if (normalizedDedupeKey && isDuplicateInsertError(error)) {
      return null;
    }
    throw error;
  }

  const created = await getNotificationById(notificationId);
  if (created) {
    emitNotificationCreated(created);
  }
  return created;
}

async function createWelcomeNotificationForUser(userId) {
  try {
    await createNotification({
      userId,
      type: "welcome",
      title: "Welcome to IncentApply",
      message: "You are all set. Create or join a group and start tracking applications.",
      payload: { kind: "welcome" },
      dedupeKey: "welcome:first-join"
    });
  } catch (error) {
    console.warn(
      `Unable to create welcome notification for user ${userId}. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

async function createGroupInviteNotification({
  recipientUserId,
  groupId,
  groupName,
  invitedByUserId,
  invitedByDisplayName
}) {
  try {
    await createNotification({
      userId: recipientUserId,
      groupId,
      type: "group_invite",
      title: "New Group Invite",
      message: `${invitedByDisplayName} invited you to join "${groupName}".`,
      payload: {
        groupId,
        groupName,
        invitedByUserId,
        invitedByDisplayName
      },
      dedupeKey: `group-invite:${groupId}:${recipientUserId}`
    });
  } catch (error) {
    console.warn(
      `Unable to create group invite notification for user ${recipientUserId}. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

function createGoalReminderMessage(groupName, goalCycle, applicationGoal) {
  const goalText = Math.max(0, Number(applicationGoal ?? 0));
  const cycleLabel = goalCycle === "daily" ? "daily" : goalCycle === "biweekly" ? "biweekly" : "weekly";
  return `Reminder for ${groupName}: your ${cycleLabel} goal is ${goalText} applications.`;
}

async function ensureGoalReminderNotificationsForUser(userId, referenceDate = new Date()) {
  if (!userId) {
    return 0;
  }

  const groupsResult = await pool.query(
    `
      SELECT g.*
      FROM app_groups g
      INNER JOIN group_members gm
        ON gm.group_id = g.id
      WHERE gm.user_id = $1
      ORDER BY g.created_at DESC
    `,
    [userId]
  );

  if (!groupsResult.rows.length) {
    return 0;
  }

  const now = new Date(referenceDate);
  let createdCount = 0;
  for (const group of groupsResult.rows) {
    const cycle = getCycleWindowForGroup(group, now);
    if (now.getTime() >= cycle.endsAt.getTime()) {
      continue;
    }

    const groupName = String(group.name ?? "Group");
    const applicationGoal = Math.max(0, Number(group.weekly_goal ?? 0));
    if (cycle.goalCycle === "daily") {
      const reminderAt = new Date(cycle.startsAt.getTime() + 12 * 60 * 60 * 1000);
      if (now.getTime() < reminderAt.getTime() || reminderAt.getTime() >= cycle.endsAt.getTime()) {
        continue;
      }

      const created = await createNotification({
        userId,
        groupId: group.id,
        type: "goal_reminder",
        title: "Daily Goal Reminder",
        message: createGoalReminderMessage(groupName, cycle.goalCycle, applicationGoal),
        payload: {
          groupId: group.id,
          groupName,
          goalCycle: cycle.goalCycle,
          cycleKey: cycle.cycleKey,
          cycleStartsAt: cycle.startsAt.toISOString(),
          cycleEndsAt: cycle.endsAt.toISOString(),
          reminderAt: reminderAt.toISOString(),
          applicationGoal
        },
        dedupeKey: `goal-reminder:${group.id}:${userId}:${cycle.cycleKey}:12h`
      });
      if (created) {
        createdCount += 1;
      }
      continue;
    }

    if (cycle.goalCycle !== "weekly" && cycle.goalCycle !== "biweekly") {
      continue;
    }

    const cycleStartLocalDay = toUtcCalendarDate(cycle.startsAt, APP_TIME_ZONE);
    const cycleEndLocalDay = toUtcCalendarDate(cycle.endsAt, APP_TIME_ZONE);
    const todayLocalDay = toUtcCalendarDate(now, APP_TIME_ZONE);
    let cursor = new Date(cycleStartLocalDay);

    while (
      cursor.getTime() < cycleEndLocalDay.getTime() &&
      cursor.getTime() <= todayLocalDay.getTime()
    ) {
      const reminderAt = zonedLocalToUtc(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth() + 1,
        cursor.getUTCDate(),
        12,
        0,
        0,
        APP_TIME_ZONE
      );
      if (now.getTime() >= reminderAt.getTime() && reminderAt.getTime() < cycle.endsAt.getTime()) {
        const reminderDayKey = utcCalendarDateYmd(cursor);
        const created = await createNotification({
          userId,
          groupId: group.id,
          type: "goal_reminder",
          title: "Goal Reminder",
          message: createGoalReminderMessage(groupName, cycle.goalCycle, applicationGoal),
          payload: {
            groupId: group.id,
            groupName,
            goalCycle: cycle.goalCycle,
            cycleKey: cycle.cycleKey,
            cycleStartsAt: cycle.startsAt.toISOString(),
            cycleEndsAt: cycle.endsAt.toISOString(),
            reminderAt: reminderAt.toISOString(),
            reminderDay: reminderDayKey,
            applicationGoal
          },
          dedupeKey: `goal-reminder:${group.id}:${userId}:${cycle.cycleKey}:${reminderDayKey}:12h`
        });
        if (created) {
          createdCount += 1;
        }
      }
      cursor = addUtcCalendarDays(cursor, 1);
    }
  }

  return createdCount;
}

async function ensureGoalReminderNotificationsForAllUsers(referenceDate = new Date()) {
  const result = await pool.query(
    `
      SELECT DISTINCT user_id
      FROM group_members
    `
  );

  if (!result.rows.length) {
    return 0;
  }

  let createdCount = 0;
  for (const row of result.rows) {
    const userId = String(row.user_id ?? "").trim();
    if (!userId) {
      continue;
    }
    createdCount += await ensureGoalReminderNotificationsForUser(userId, referenceDate);
  }
  return createdCount;
}

async function runGoalReminderJob() {
  if (goalReminderJobRunning) {
    return;
  }
  goalReminderJobRunning = true;
  try {
    await ensureGoalReminderNotificationsForAllUsers(new Date());
  } catch (error) {
    console.warn(
      `Goal reminder job failed. ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    goalReminderJobRunning = false;
  }
}

function startGoalReminderJob() {
  if (goalReminderJobInterval) {
    return;
  }

  void runGoalReminderJob();
  goalReminderJobInterval = setInterval(() => {
    void runGoalReminderJob();
  }, GOAL_REMINDER_JOB_INTERVAL_MS);
  goalReminderJobInterval.unref?.();
}

function chatRetentionCutoff(referenceDate = new Date()) {
  const nowMs = referenceDate instanceof Date ? referenceDate.getTime() : Date.now();
  return new Date(nowMs - CHAT_MESSAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

async function purgeExpiredGroupChatMessages(referenceDate = new Date()) {
  const cutoff = chatRetentionCutoff(referenceDate);
  const deleted = await pool.query(
    `
      DELETE FROM group_chat_messages
      WHERE created_at < $1
    `,
    [cutoff]
  );

  return Math.max(0, Number(deleted.rowCount ?? 0));
}

async function runChatCleanupJob() {
  if (chatCleanupJobRunning) {
    return;
  }
  chatCleanupJobRunning = true;
  try {
    await purgeExpiredGroupChatMessages(new Date());
  } catch (error) {
    console.warn(
      `Chat cleanup job failed. ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    chatCleanupJobRunning = false;
  }
}

function startChatCleanupJob() {
  if (chatCleanupJobInterval) {
    return;
  }

  void runChatCleanupJob();
  chatCleanupJobInterval = setInterval(() => {
    void runChatCleanupJob();
  }, CHAT_CLEANUP_JOB_INTERVAL_MS);
  chatCleanupJobInterval.unref?.();
}

function normalizeNotificationLimit(limit) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed)) {
    return NOTIFICATION_DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(500, Math.floor(parsed)));
}

async function listNotificationsForUser(userId, limit = NOTIFICATION_DEFAULT_LIMIT) {
  const safeLimit = normalizeNotificationLimit(limit);
  const result = await pool.query(
    `
      SELECT
        id,
        user_id,
        group_id,
        notification_type,
        title,
        message,
        payload_json,
        dedupe_key,
        created_at,
        read_at
      FROM app_notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [userId, safeLimit]
  );

  return result.rows.map((row) => toAppNotification(row));
}

async function countUnreadNotificationsForUser(userId) {
  const result = await pool.query(
    `
      SELECT COUNT(*) AS count
      FROM app_notifications
      WHERE user_id = $1
        AND read_at IS NULL
    `,
    [userId]
  );

  return Math.max(0, Number(result.rows[0]?.count ?? 0));
}

async function markNotificationRead(userId, notificationId) {
  const existing = await pool.query(
    `
      SELECT 1
      FROM app_notifications
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [notificationId, userId]
  );
  if (!existing.rows.length) {
    return false;
  }

  await pool.query(
    `
      UPDATE app_notifications
      SET read_at = COALESCE(read_at, NOW())
      WHERE id = $1
        AND user_id = $2
    `,
    [notificationId, userId]
  );

  return true;
}

async function markAllNotificationsRead(userId) {
  await pool.query(
    `
      UPDATE app_notifications
      SET read_at = NOW()
      WHERE user_id = $1
        AND read_at IS NULL
    `,
    [userId]
  );
}

async function dismissNotification(userId, notificationId) {
  const existing = await pool.query(
    `
      SELECT dedupe_key
      FROM app_notifications
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [notificationId, userId]
  );
  const notification = existing.rows[0] ?? null;
  if (!notification) {
    return false;
  }

  await pool.query(
    `
      DELETE FROM app_notifications
      WHERE id = $1
        AND user_id = $2
    `,
    [notificationId, userId]
  );

  const dedupeKey = String(notification.dedupe_key ?? "").trim();
  if (dedupeKey) {
    await recordNotificationDismissal(userId, dedupeKey);
  }

  return true;
}

async function createEmailUser({ email, password, firstName, lastName, timezone }) {
  const passwordHash = await hash(password, PASSWORD_HASH_OPTIONS);
  const id = randomUUID();
  const normalizedTimeZone = normalizeUserTimeZone(timezone);

  if (poolMode === "mysql") {
    await pool.query(
      `
        INSERT INTO users (
          id, email, password_hash, first_name, last_name, timezone, auth_provider
        )
        VALUES ($1, $2, $3, $4, $5, $6, 'email')
      `,
      [id, email, passwordHash, firstName, lastName, normalizedTimeZone]
    );
    return requireUserById(id);
  }

  const result = await pool.query(
    `
      INSERT INTO users (
        id, email, password_hash, first_name, last_name, timezone, auth_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'email')
      RETURNING *
    `,
    [id, email, passwordHash, firstName, lastName, normalizedTimeZone]
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

  const email = normalizeEmail(payload.email);
  const googleSub = payload.sub;
  const normalizedTimeZone = normalizeUserTimeZone(options.timezone);

  const byGoogleSub = await getUserByGoogleSub(googleSub);
  if (byGoogleSub) {
    return byGoogleSub;
  }

  const byEmail = await getUserByEmail(email);
  if (byEmail) {
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
          id, email, google_sub, first_name, last_name, avatar_url, timezone, auth_provider
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, 'google')
      `,
      [
        id,
        email,
        googleSub,
        payload.given_name ?? null,
        payload.family_name ?? null,
        payload.picture ?? null,
        normalizedTimeZone
      ]
    );
    return requireUserById(id);
  }

  const created = await pool.query(
    `
      INSERT INTO users (
        id, email, google_sub, first_name, last_name, avatar_url, timezone, auth_provider
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'google')
      RETURNING *
    `,
    [
      id,
      email,
      googleSub,
      payload.given_name ?? null,
      payload.family_name ?? null,
      payload.picture ?? null,
      normalizedTimeZone
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
  redirectUri = GOOGLE_REDIRECT_URI,
  timezone = APP_TIME_ZONE
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
  const normalizedTimeZone = normalizeUserTimeZone(timezone);
  const state = Buffer.from(
    JSON.stringify({
      redirectPath: normalizedRedirectPath,
      mode: normalizedMode,
      intent: normalizedIntent,
      timezone: normalizedTimeZone
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
  let timezone = APP_TIME_ZONE;

  if (!stateEncoded) {
    return { redirectPath, mode, intent, timezone };
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

    if (typeof parsed.timezone === "string" && isValidTimeZone(parsed.timezone)) {
      timezone = parsed.timezone.trim();
    }
  } catch {
    // Ignore invalid state payloads and fall back to defaults.
  }

  return { redirectPath, mode, intent, timezone };
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
    const { email, password, firstName, lastName, timezone } = req.body ?? {};

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
          lastName: lastName ? String(lastName) : null,
          timezone: normalizeUserTimeZone(timezone)
        });

    await createWelcomeNotificationForUser(user.id);
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

    await createWelcomeNotificationForUser(user.id);
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
    const timezone =
      typeof req.query.timezone === "string"
        ? normalizeUserTimeZone(req.query.timezone)
        : APP_TIME_ZONE;
    const redirectUri = resolveGoogleRedirectUri(req);
    const url = createGoogleAuthUrl(redirectPath, mode, intent, redirectUri, timezone);
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
    const timezone =
      typeof req.query.timezone === "string"
        ? normalizeUserTimeZone(req.query.timezone)
        : APP_TIME_ZONE;
    const redirectUri = resolveGoogleRedirectUri(req);
    const url = createGoogleAuthUrl(redirectPath, mode, intent, redirectUri, timezone);

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
    const { code, intent, timezone } = req.body ?? {};
    if (!code) {
      return res.status(400).json({ error: "Google authorization code is required." });
    }

    const normalizedIntent = intent === "signup" ? "signup" : "login";
    const redirectUri = resolveGoogleRedirectUri(req);
    const user = await exchangeGoogleCode(String(code), {
      intent: normalizedIntent,
      redirectUri,
      timezone: normalizeUserTimeZone(timezone)
    });
    await createWelcomeNotificationForUser(user.id);
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
    await createWelcomeNotificationForUser(user.id);
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
      redirectUri,
      timezone: oauthState.timezone
    });
    await createWelcomeNotificationForUser(user.id);
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
    await createWelcomeNotificationForUser(user.id);
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
        timezone: normalizeUserTimeZone(user.timezone),
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
    const hasTimezoneField = Object.prototype.hasOwnProperty.call(req.body ?? {}, "timezone");
    const timezoneRaw = hasTimezoneField ? req.body?.timezone : undefined;

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
    const timezone =
      timezoneRaw === undefined
        ? undefined
        : typeof timezoneRaw === "string"
          ? timezoneRaw.trim()
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
    if (timezone === "__invalid__") {
      return res.status(400).json({ error: "Timezone must be a valid IANA timezone string." });
    }
    if (typeof timezone === "string" && !isValidTimeZone(timezone)) {
      return res.status(400).json({ error: "Timezone must be a valid IANA timezone string." });
    }

    const existingWithEmail = await getUserByEmail(email);
    if (existingWithEmail && existingWithEmail.id !== userId) {
      return res.status(409).json({ error: "An account already exists with this email." });
    }

    const setClauses = ["first_name = $2", "last_name = $3", "email = $4"];
    const params = [userId, firstName, lastName, email];

    if (hasAvatarUrlField) {
      setClauses.push(`avatar_url = $${params.length + 1}`);
      params.push(avatarUrl && avatarUrl.length ? avatarUrl : null);
    }
    if (hasTimezoneField) {
      setClauses.push(`timezone = $${params.length + 1}`);
      params.push(normalizeUserTimeZone(timezone));
    }
    setClauses.push("updated_at = NOW()");

    await pool.query(
      `
        UPDATE users
        SET ${setClauses.join(", ")}
        WHERE id = $1
      `,
      params
    );

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
        timezone: normalizeUserTimeZone(updatedUser.timezone),
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
    const recipientUsers = [];
    for (const recipientEmail of recipients) {
      const recipientUser = await getUserByEmail(recipientEmail);
      if (!recipientUser) {
        missingRecipients.push(recipientEmail);
      } else {
        recipientUsers.push(recipientUser);
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

    const invitedByDisplayName = memberDisplayName(user);
    for (const recipientUser of recipientUsers) {
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
        [randomUUID(), groupId, normalizeEmail(recipientUser.email), user.id, inviteExpiryValue]
      );

      await createGroupInviteNotification({
        recipientUserId: recipientUser.id,
        groupId,
        groupName: normalizedName,
        invitedByUserId: user.id,
        invitedByDisplayName
      });
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

    const currentGroup = await getGroupByIdForMember(groupId, userId);
    if (!currentGroup) {
      return res.status(404).json({ error: "Group not found." });
    }
    await ensureSettlementLogsForGroup(currentGroup);

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

    const group = await getGroupByIdForMember(groupId, userId);
    if (!group) {
      return res.status(404).json({ error: "Group not found." });
    }
    await ensureSettlementLogsForGroup(group);

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

app.post("/api/groups/:groupId/leave", authMiddleware, async (req, res) => {
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
    if (role === "admin") {
      return res.status(403).json({
        error: "Admins cannot leave a group. Delete the group instead."
      });
    }

    const removed = await pool.query(
      `
        DELETE FROM group_members
        WHERE group_id = $1
          AND user_id = $2
      `,
      [groupId, userId]
    );
    if (Number(removed.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: "Membership not found." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to leave group."
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
    if (saved > currentValue) {
      await appendCounterApplicationLogs({
        userId: memberId,
        group,
        cycle,
        fromExclusive: currentValue,
        toInclusive: saved
      });
    } else if (saved < currentValue) {
      await removeRecentCounterApplicationLogs({
        userId: memberId,
        groupId,
        cycleKey: cycle.cycleKey,
        count: currentValue - saved
      });
    }

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

app.get("/api/groups/:groupId/chat/messages", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    if (!groupId) {
      return res.status(400).json({ error: "Group id is required." });
    }

    await purgeExpiredGroupChatMessages(new Date());

    const isMember = await isMemberInGroup(groupId, userId);
    if (!isMember) {
      return res.status(404).json({ error: "Group not found." });
    }

    const requestedLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 200;
    const messages = await listGroupChatMessages(groupId, userId, requestedLimit);
    return res.status(200).json({ messages });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch group chat messages."
    });
  }
});

app.post("/api/groups/:groupId/chat/messages", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const groupId = String(req.params.groupId ?? "").trim();
    if (!groupId) {
      return res.status(400).json({ error: "Group id is required." });
    }

    await purgeExpiredGroupChatMessages(new Date());

    const isMember = await isMemberInGroup(groupId, userId);
    if (!isMember) {
      return res.status(404).json({ error: "Group not found." });
    }

    const body = typeof req.body?.body === "string" ? req.body.body : "";
    const replyToMessageId =
      typeof req.body?.replyToMessageId === "string" ? req.body.replyToMessageId : null;
    const message = await createGroupChatMessage({
      groupId,
      userId,
      body,
      replyToMessageId
    });

    return res.status(201).json({ message });
  } catch (error) {
    const statusCode = error instanceof HttpError ? error.statusCode : 500;
    return res.status(statusCode).json({
      error: error instanceof Error ? error.message : "Unable to create group chat message."
    });
  }
});

app.post(
  "/api/groups/:groupId/chat/messages/:messageId/reactions",
  authMiddleware,
  async (req, res) => {
    try {
      const userId = req.auth?.sub;
      if (!userId) {
        return res.status(401).json({ error: "Missing user identity." });
      }

      const groupId = String(req.params.groupId ?? "").trim();
      const messageId = String(req.params.messageId ?? "").trim();
      if (!groupId || !messageId) {
        return res.status(400).json({ error: "Group id and message id are required." });
      }

      await purgeExpiredGroupChatMessages(new Date());

      const isMember = await isMemberInGroup(groupId, userId);
      if (!isMember) {
        return res.status(404).json({ error: "Group not found." });
      }

      const emoji = typeof req.body?.emoji === "string" ? req.body.emoji : "";
      const result = await toggleGroupChatReaction({
        groupId,
        messageId,
        userId,
        emoji
      });
      return res.status(200).json(result);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      return res.status(statusCode).json({
        error: error instanceof Error ? error.message : "Unable to react to message."
      });
    }
  }
);

app.get("/api/applications/counter-logs", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const logs = await listCounterApplicationLogsForUser(userId, 500);
    return res.status(200).json({ logs });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch application logs."
    });
  }
});

app.get("/api/settlements/logs", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    await ensureSettlementLogsForUser(userId);
    const logs = await listSettlementLogsForUser(userId, 500);
    return res.status(200).json({ logs });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch settlement logs."
    });
  }
});

app.get("/api/notifications", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const requestedLimit =
      typeof req.query.limit === "string" ? Number(req.query.limit) : NOTIFICATION_DEFAULT_LIMIT;
    const limit = normalizeNotificationLimit(requestedLimit);

    await ensureGoalReminderNotificationsForUser(userId);
    const notifications = await listNotificationsForUser(userId, limit);
    const unreadCount = await countUnreadNotificationsForUser(userId);
    return res.status(200).json({ notifications, unreadCount });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to fetch notifications."
    });
  }
});

app.patch("/api/notifications/:notificationId/read", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const notificationId = String(req.params.notificationId ?? "").trim();
    if (!notificationId) {
      return res.status(400).json({ error: "Notification id is required." });
    }

    const marked = await markNotificationRead(userId, notificationId);
    if (!marked) {
      return res.status(404).json({ error: "Notification not found." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to update notification."
    });
  }
});

app.patch("/api/notifications/read-all", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    await markAllNotificationsRead(userId);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to update notifications."
    });
  }
});

app.delete("/api/notifications/:notificationId", authMiddleware, async (req, res) => {
  try {
    const userId = req.auth?.sub;
    if (!userId) {
      return res.status(401).json({ error: "Missing user identity." });
    }

    const notificationId = String(req.params.notificationId ?? "").trim();
    if (!notificationId) {
      return res.status(400).json({ error: "Notification id is required." });
    }

    const removed = await dismissNotification(userId, notificationId);
    if (!removed) {
      return res.status(404).json({ error: "Notification not found." });
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to dismiss notification."
    });
  }
});

app.get("/api/notifications/stream", async (req, res) => {
  const authorizationHeader = String(req.headers.authorization ?? "");
  const bearerToken = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length).trim()
    : "";
  const queryToken = typeof req.query.token === "string" ? req.query.token.trim() : "";
  const token = bearerToken || queryToken;

  if (!token) {
    return res.status(401).json({ error: "Missing bearer token." });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Invalid token." });
  }

  const userId = String(decoded?.sub ?? "").trim();
  if (!userId) {
    return res.status(401).json({ error: "Invalid token payload." });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const removeClient = addNotificationSseClient(userId, res);
  const heartbeat = setInterval(() => {
    try {
      res.write(": keepalive\n\n");
    } catch {
      // closed connection handled by close listener
    }
  }, 25000);
  heartbeat.unref?.();

  writeSseEvent(res, "connected", { ok: true, userId, connectedAt: new Date().toISOString() });
  try {
    await ensureGoalReminderNotificationsForUser(userId);
  } catch (error) {
    console.warn(
      `Unable to preload goal reminders for SSE stream user ${userId}. ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  const onClose = () => {
    clearInterval(heartbeat);
    removeClient();
  };

  req.on("close", onClose);
  req.on("error", onClose);
  return undefined;
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

startGoalReminderJob();
startChatCleanupJob();

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
