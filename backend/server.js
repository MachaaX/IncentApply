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

function createInMemoryPool() {
  const db = newDb();
  const { Pool: InMemoryPool } = db.adapters.createPg();
  return new InMemoryPool();
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
      const mysqlSql = sql.replace(/\$\d+/g, "?");
      const [rows] = await mysqlPool.query(mysqlSql, params);

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
  if (!GOOGLE_REDIRECT_URI) {
    missing.push("GOOGLE_REDIRECT_URI");
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
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
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

  const tokenResult = await oauthClient.getToken(code);
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

function createGoogleAuthUrl(redirectPath = "/dashboard", mode = "redirect", intent = "login") {
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
    state
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

function resolveFrontendBaseUrl(req) {
  const configuredUrl = FRONTEND_URL;
  const shouldAutoDetectHost =
    process.env.NODE_ENV === "production" && isLocalFrontendUrl(configuredUrl);

  if (!shouldAutoDetectHost && configuredUrl) {
    return configuredUrl;
  }

  const forwardedProtoHeader = req.headers["x-forwarded-proto"];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;
  const protocol = forwardedProto ?? req.protocol ?? "https";

  const forwardedHostHeader = req.headers["x-forwarded-host"];
  const forwardedHost = Array.isArray(forwardedHostHeader)
    ? forwardedHostHeader[0]
    : forwardedHostHeader;
  const host = forwardedHost ?? req.get("host");

  if (!host) {
    return configuredUrl;
  }

  return `${protocol}://${host}`;
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
    const url = createGoogleAuthUrl(redirectPath, mode, intent);
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
    const url = createGoogleAuthUrl(redirectPath, mode, intent);

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
    const user = await exchangeGoogleCode(String(code), { intent: normalizedIntent });
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

  try {
    const oauthError = typeof req.query.error === "string" ? req.query.error : "";
    if (oauthError) {
      throw new Error(`Google authorization failed: ${oauthError}.`);
    }

    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      throw new Error("Missing Google OAuth code.");
    }

    const user = await exchangeGoogleCode(code, { intent: oauthState.intent });
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
