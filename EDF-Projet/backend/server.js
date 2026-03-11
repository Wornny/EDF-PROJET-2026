const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const mqtt = require("mqtt");
const mysql = require("mysql2/promise");
const sqlite3 = require("sqlite3");
const { createLoginController } = require("./controllers/loginControlleur");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "";
const FRONTEND_ORIGINS = (process.env.FRONTEND_ORIGINS || FRONTEND_ORIGIN)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL !== "false";
const MQTT_ENABLED = process.env.MQTT_ENABLED === "true";
const SQLITE_DB_PATH = process.env.AUTH_DB_PATH || path.join(__dirname, "database", "users.db");

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const app = express();

function isOriginAllowed(origin) {
  if (!origin) {
    return true;
  }

  if (CORS_ALLOW_ALL) {
    return true;
  }

  if (FRONTEND_ORIGINS.length === 0) {
    return true;
  }

  return FRONTEND_ORIGINS.includes(origin);
}

app.use(
  cors({
    origin(origin, callback) {
      if (isOriginAllowed(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Origin not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =========================
// Session + Login lock
// =========================
const sessions = new Map();
const loginLocks = new Map();

function getClientKey(req) {
  const ip = req.ip || req.socket?.remoteAddress || "unknown";
  const ua = req.headers["user-agent"] || "unknown";
  return `${ip}__${ua}`;
}

function parseAuthToken(req) {
  const auth = req.headers.authorization || "";
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  const xToken = req.headers["x-session-token"];
  if (typeof xToken === "string") {
    return xToken.trim();
  }

  return "";
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [token, data] of sessions.entries()) {
    if (now - data.lastSeenAt > SESSION_TTL_MS) {
      sessions.delete(token);
    }
  }
}

setInterval(cleanupExpiredSessions, 60 * 1000).unref();

function authRequired(req, res, next) {
  if (!req.path.startsWith("/api/")) {
    return next();
  }

  const publicPaths = new Set([
    "/api/test",
    "/api/health",
    "/api/login",
  ]);

  if (publicPaths.has(req.path)) {
    return next();
  }

  const token = parseAuthToken(req);
  const session = token ? sessions.get(token) : null;
  if (!session || !session.isAuthenticated) {
    return res.status(401).json({ ok: false, error: "Authentification requise." });
  }

  session.lastSeenAt = Date.now();
  req.session = session;
  req.sessionToken = token;
  return next();
}

app.use(authRequired);

// =========================
// MySQL
// =========================
const mysqlPool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "edf_project",
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
});

function sqliteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function sqliteDbExists() {
  return fs.existsSync(SQLITE_DB_PATH);
}

function openSqliteReadOnly(dbPath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(db);
    });
  });
}

function sqliteAll(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.all(query, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

function sqliteGet(db, query, params = []) {
  return new Promise((resolve, reject) => {
    db.get(query, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row || null);
    });
  });
}

function sqliteClose(db) {
  return new Promise((resolve, reject) => {
    db.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function authenticateUserFromSqlite(username, password) {
  if (!sqliteDbExists()) {
    return null;
  }

  let db;
  try {
    db = await openSqliteReadOnly(SQLITE_DB_PATH);
    const columnsRows = await sqliteAll(db, 'PRAGMA table_info("users")');
    const columns = new Set(columnsRows.map((row) => row.name));

    const loginColumns = ["login", "username", "identifiant", "user", "utilisateur"].filter((c) =>
      columns.has(c),
    );
    const passwordColumns = ["password", "mot_de_passe", "mdp", "pass"].filter((c) =>
      columns.has(c),
    );

    if (loginColumns.length === 0 || passwordColumns.length === 0) {
      return false;
    }

    const selectedColumns = [...new Set([...loginColumns, ...passwordColumns])]
      .map((c) => sqliteIdentifier(c))
      .join(", ");
    const whereClause = loginColumns.map((c) => `LOWER(${sqliteIdentifier(c)}) = LOWER(?)`).join(" OR ");
    const params = loginColumns.map(() => username);
    const row = await sqliteGet(
      db,
      `SELECT ${selectedColumns} FROM "users" WHERE ${whereClause} LIMIT 1`,
      params,
    );

    if (!row) {
      return false;
    }

    return passwordColumns.some((column) => String(row[column] ?? "") === password);
  } catch (error) {
    return false;
  } finally {
    if (db) {
      try {
        await sqliteClose(db);
      } catch {
        // Ignore close errors.
      }
    }
  }
}

async function authenticateUser(username, password) {
  if (!username || !password) {
    return false;
  }

  // Fallback dev credentials if DB is not ready.
  const devLogin = process.env.DEV_LOGIN;
  const devPassword = process.env.DEV_PASSWORD;
  if (devLogin && devPassword && username === devLogin && password === devPassword) {
    return true;
  }

  const sqliteResult = await authenticateUserFromSqlite(username, password);
  if (sqliteResult !== null) {
    return sqliteResult;
  }

  try {
    const [columnsRows] = await mysqlPool.query("SHOW COLUMNS FROM users");
    const columns = new Set(columnsRows.map((row) => row.Field));

    const loginColumns = ["login", "username", "identifiant", "user", "utilisateur"].filter((c) =>
      columns.has(c),
    );
    const passwordColumns = ["password", "mot_de_passe", "mdp", "pass"].filter((c) =>
      columns.has(c),
    );

    if (loginColumns.length === 0 || passwordColumns.length === 0) {
      return false;
    }

    const selected = [...new Set([...loginColumns, ...passwordColumns])]
      .map((c) => `\`${c}\``)
      .join(", ");
    const where = loginColumns.map((c) => `LOWER(\`${c}\`) = LOWER(?)`).join(" OR ");
    const values = loginColumns.map(() => username);

    const [rows] = await mysqlPool.query(`SELECT ${selected} FROM users WHERE ${where} LIMIT 1`, values);
    if (!rows.length) {
      return false;
    }

    const row = rows[0];
    return passwordColumns.some((column) => String(row[column] ?? "") === password);
  } catch (error) {
    return false;
  }
}

async function sqliteHealth() {
  if (!sqliteDbExists()) {
    return {
      ok: false,
      path: SQLITE_DB_PATH,
      error: "users.db introuvable.",
    };
  }

  let db;
  try {
    db = await openSqliteReadOnly(SQLITE_DB_PATH);
    await sqliteGet(db, "SELECT 1 AS ok");
    return {
      ok: true,
      path: SQLITE_DB_PATH,
    };
  } catch (error) {
    return {
      ok: false,
      path: SQLITE_DB_PATH,
      error: error.message,
    };
  } finally {
    if (db) {
      try {
        await sqliteClose(db);
      } catch {
        // Ignore close errors.
      }
    }
  }
}

async function mysqlHealth() {
  try {
    await mysqlPool.query("SELECT 1");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

// =========================
// MQTT + App state
// =========================
const cmNames = {};
const cmValues = {};
const cpoNames = {};
const cpoValues = {};
const c2Names = { 1: "C2 ID 1", 2: "C2 ID 2" };
const c2Values = {};

for (let i = 1; i <= 11; i += 1) {
  cmNames[i] = `CM ID ${i}`;
  cmValues[i] = { NivContamination: "1", BruitDeFond: "0.50" };
}
for (let i = 1; i <= 2; i += 1) {
  cpoNames[i] = `CPO ID ${i}`;
  cpoValues[i] = { NivContamination: "1", BruitDeFond: "0.50" };
}

function ensureCm(id) {
  if (!cmNames[id]) cmNames[id] = `CM ID ${id}`;
  if (!cmValues[id]) cmValues[id] = { NivContamination: "1", BruitDeFond: "0.50" };
}

function ensureCpo(id) {
  if (!cpoNames[id]) cpoNames[id] = `CPO ID ${id}`;
  if (!cpoValues[id]) cpoValues[id] = { NivContamination: "1", BruitDeFond: "0.50" };
}

function ensureC2(id) {
  if (!c2Names[id]) c2Names[id] = `C2 ID ${id}`;
  if (!c2Values[id]) c2Values[id] = { F: [], D: [] };
}

function normalizeNumericList(values) {
  if (!Array.isArray(values)) return [];
  const result = values
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value));
  return [...new Set(result)].sort((a, b) => a - b);
}

function extractNumericSensorIds(values, prefix) {
  if (!values || typeof values !== "object") return [];

  const ids = [];
  Object.entries(values).forEach(([key, isActive]) => {
    if (!isActive || typeof key !== "string" || !key.startsWith(prefix)) {
      return;
    }
    const digits = key.replace(/\D/g, "");
    if (!digits) return;
    ids.push(Number.parseInt(digits, 10));
  });

  return [...new Set(ids)].sort((a, b) => a - b);
}

function extractC2NumericId(rawToken) {
  const raw = String(rawToken || "").trim();
  if (!raw) return null;

  const prefixed = raw.match(/^C2[\s_-]*(\d+)$/i);
  if (prefixed) {
    const n = Number.parseInt(prefixed[1], 10);
    return Number.isFinite(n) ? n : null;
  }

  const groups = raw.match(/\d+/g);
  if (!groups || !groups.length) return null;

  const n = Number.parseInt(groups[groups.length - 1], 10);
  return Number.isFinite(n) ? n : null;
}

let mqttClient = null;

function mqttTopicCmContamination(cmId) {
  return `FormaReaEDF/ControllerMobile/CM_${cmId}/NivContamination`;
}

function mqttTopicCmBdf(cmId) {
  return `FormaReaEDF/ControllerMobile/CM_${cmId}/BruitDeFond`;
}

function mqttTopicCpoContamination(cpoId) {
  return `FormaReaEDF/CPO/CPO_${cpoId}/NivContamination`;
}

function mqttTopicCpoBdf(cpoId) {
  return `FormaReaEDF/CPO/CPO_${cpoId}/BruitDeFond`;
}

function publishMqtt(topic, payload) {
  if (!MQTT_ENABLED || !mqttClient || !mqttClient.connected) {
    return;
  }

  mqttClient.publish(topic, payload, { retain: true, qos: 1 });
}

if (MQTT_ENABLED) {
  const mqttUrl = process.env.MQTT_URL || "mqtt://localhost:1883";
  const mqttOptions = {
    clientId: process.env.MQTT_CLIENT_ID || `IHM_Node_${crypto.randomUUID().slice(0, 8)}`,
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
  };

  mqttClient = mqtt.connect(mqttUrl, mqttOptions);

  mqttClient.on("connect", () => {
    mqttClient.subscribe("FormaReaEDF/ControllerMobile/+/+");
    mqttClient.subscribe("FormaReaEDF/CPO/+/+");
    mqttClient.subscribe("FormaReaEDF/C2/+/Capteurs");
  });

  mqttClient.on("message", (topic, payloadBuffer) => {
    const payload = String(payloadBuffer || "").replace("Bq/cm²", "").replace("Bq", "").trim();

    if (topic.startsWith("FormaReaEDF/ControllerMobile/")) {
      const parts = topic.split("/");
      const token = parts[2] || "";
      const cmId = Number.parseInt(token.replace("CM_", ""), 10);
      if (!Number.isFinite(cmId) || cmId < 1) return;
      ensureCm(cmId);

      if (topic.includes("NivContamination")) {
        cmValues[cmId].NivContamination = payload;
      } else if (topic.includes("BruitDeFond")) {
        cmValues[cmId].BruitDeFond = payload;
      }
      return;
    }

    if (topic.startsWith("FormaReaEDF/CPO/")) {
      const parts = topic.split("/");
      const token = parts[2] || "";
      const cpoId = Number.parseInt(token.replace("CPO_", ""), 10);
      if (!Number.isFinite(cpoId) || cpoId < 1) return;
      ensureCpo(cpoId);

      if (topic.includes("NivContamination")) {
        cpoValues[cpoId].NivContamination = payload;
      } else if (topic.includes("BruitDeFond")) {
        cpoValues[cpoId].BruitDeFond = payload;
      }
      return;
    }

    if (topic.startsWith("FormaReaEDF/C2/") && topic.endsWith("/Capteurs")) {
      const parts = topic.split("/");
      const c2Id = extractC2NumericId(parts[2]);
      if (!c2Id || c2Id < 1) return;
      ensureC2(c2Id);

      try {
        const data = JSON.parse(payload);
        c2Values[c2Id] = {
          F: normalizeNumericList(data.F),
          D: normalizeNumericList(data.D),
        };
      } catch {
        // Ignore invalid payloads.
      }
    }
  });

  mqttClient.on("error", () => {
    // Avoid crashing the app if broker is unavailable.
  });
}

// =========================
// Login / Logout / Health
// =========================
app.get("/api/test", (req, res) => {
  res.json({ message: "API fonctionne" });
});

app.get("/api/health", async (req, res) => {
  const db = await mysqlHealth();
  const sqlite = await sqliteHealth();
  res.json({
    ok: true,
    service: "backend",
    mqtt: {
      enabled: MQTT_ENABLED,
      connected: Boolean(mqttClient?.connected),
    },
    mysql: db,
    sqlite,
  });
});

const loginController = createLoginController({
  sessions,
  loginLocks,
  authenticateUser,
  parseAuthToken,
  getClientKey,
});

app.post("/api/login", loginController.login);
app.post("/api/logout", loginController.logout);

app.get("/api/menu", (req, res) => {
  res.json({ ok: true, message: "Menu accessible" });
});

// =========================
// CM APIs
// =========================
app.get("/api/cm", (req, res) => {
  const ids = Object.keys(cmNames)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  res.json({ ok: true, ids, names: cmNames });
});

app.get("/api/cm/:cmId/state", (req, res) => {
  const cmId = Number.parseInt(req.params.cmId, 10);
  if (!Number.isFinite(cmId) || cmId < 1) {
    return res.status(400).json({ ok: false, error: "ID CM invalide." });
  }
  ensureCm(cmId);
  return res.json({ ok: true, cmId, ...cmValues[cmId] });
});

app.post("/api/cm/:cmId/slider", (req, res) => {
  const cmId = Number.parseInt(req.params.cmId, 10);
  if (!Number.isFinite(cmId) || cmId < 1) {
    return res.status(400).json({ ok: false, error: "ID CM invalide." });
  }

  const value = String(req.body.value ?? "").trim();
  const type = String(req.body.type ?? "").toLowerCase();
  if (!value) {
    return res.status(400).json({ ok: false, error: "Valeur manquante." });
  }

  ensureCm(cmId);
  if (type.includes("bruit")) {
    cmValues[cmId].BruitDeFond = value;
    publishMqtt(mqttTopicCmBdf(cmId), `${value} Bq`);
  } else {
    cmValues[cmId].NivContamination = value;
    publishMqtt(mqttTopicCmContamination(cmId), `${value} Bq`);
  }

  return res.json({ ok: true });
});

app.post("/api/cm/ajouter-appareil", (req, res) => {
  const name = String(req.body.name || "").trim();
  const type = String(req.body.type || "").trim().toUpperCase();
  if (!name) return res.status(400).json({ ok: false, error: "Le nom est obligatoire." });
  if (type !== "CM") return res.status(400).json({ ok: false, error: "Type invalide pour cette page." });

  const digits = name.match(/\d+/g);
  if (!digits || !digits.length) return res.status(400).json({ ok: false, error: "Numero manquant dans le nom." });
  const cmId = Number.parseInt(digits[digits.length - 1], 10);
  if (!Number.isFinite(cmId) || cmId < 1 || cmId > 99) {
    return res.status(400).json({ ok: false, error: "ID CM invalide (1 a 99)." });
  }

  ensureCm(cmId);
  return res.json({ ok: true });
});

app.post("/api/cm/supprimer-appareil", (req, res) => {
  const cmId = Number.parseInt(req.body.id, 10);
  if (!Number.isFinite(cmId) || cmId < 1) {
    return res.status(400).json({ ok: false, error: "ID invalide." });
  }

  delete cmNames[cmId];
  delete cmValues[cmId];
  publishMqtt(mqttTopicCmContamination(cmId), "");
  publishMqtt(mqttTopicCmBdf(cmId), "");
  return res.json({ ok: true });
});

// =========================
// CPO APIs
// =========================
app.get("/api/cpo", (req, res) => {
  const ids = Object.keys(cpoNames)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  res.json({ ok: true, ids, names: cpoNames });
});

app.get("/api/cpo/:cpoId/state", (req, res) => {
  const cpoId = Number.parseInt(req.params.cpoId, 10);
  if (!Number.isFinite(cpoId) || cpoId < 1) {
    return res.status(400).json({ ok: false, error: "ID CPO invalide." });
  }
  ensureCpo(cpoId);
  return res.json({ ok: true, cpoId, ...cpoValues[cpoId] });
});

app.post("/api/cpo/:cpoId/slider", (req, res) => {
  const cpoId = Number.parseInt(req.params.cpoId, 10);
  if (!Number.isFinite(cpoId) || cpoId < 1) {
    return res.status(400).json({ ok: false, error: "ID CPO invalide." });
  }

  const value = String(req.body.value ?? "").trim();
  const type = String(req.body.type ?? "").toLowerCase();
  if (!value) {
    return res.status(400).json({ ok: false, error: "Valeur manquante." });
  }

  ensureCpo(cpoId);
  if (type.includes("bruit")) {
    cpoValues[cpoId].BruitDeFond = value;
    publishMqtt(mqttTopicCpoBdf(cpoId), `${value} Bq`);
  } else {
    cpoValues[cpoId].NivContamination = value;
    publishMqtt(mqttTopicCpoContamination(cpoId), `${value} Bq`);
  }

  return res.json({ ok: true });
});

app.post("/api/cpo/ajouter-appareil", (req, res) => {
  const name = String(req.body.name || "").trim();
  const type = String(req.body.type || "").trim().toUpperCase();
  if (!name) return res.status(400).json({ ok: false, error: "Le nom est obligatoire." });
  if (type !== "CPO") return res.status(400).json({ ok: false, error: "Type invalide pour cette page." });

  const digits = name.match(/\d+/g);
  if (!digits || !digits.length) return res.status(400).json({ ok: false, error: "Numero manquant dans le nom." });
  const cpoId = Number.parseInt(digits[digits.length - 1], 10);
  if (!Number.isFinite(cpoId) || cpoId < 1 || cpoId > 99) {
    return res.status(400).json({ ok: false, error: "ID CPO invalide (1 a 99)." });
  }

  ensureCpo(cpoId);
  return res.json({ ok: true });
});

app.post("/api/cpo/supprimer-appareil", (req, res) => {
  const cpoId = Number.parseInt(req.body.id, 10);
  if (!Number.isFinite(cpoId) || cpoId < 1) {
    return res.status(400).json({ ok: false, error: "ID invalide." });
  }

  delete cpoNames[cpoId];
  delete cpoValues[cpoId];
  publishMqtt(mqttTopicCpoContamination(cpoId), "");
  publishMqtt(mqttTopicCpoBdf(cpoId), "");
  return res.json({ ok: true });
});

// =========================
// C2 APIs
// =========================
app.get("/api/c2", (req, res) => {
  const ids = Object.keys(c2Names)
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  res.json({ ok: true, ids, names: c2Names });
});

app.get("/api/c2/:c2Id/state", (req, res) => {
  const c2Id = Number.parseInt(req.params.c2Id, 10);
  if (!Number.isFinite(c2Id) || c2Id < 1) {
    return res.status(400).json({ ok: false, error: "ID C2 invalide." });
  }
  ensureC2(c2Id);
  return res.json({
    ok: true,
    c2_id: `C2_${c2Id}`,
    F: normalizeNumericList(c2Values[c2Id].F),
    D: normalizeNumericList(c2Values[c2Id].D),
  });
});

app.post("/api/c2/publish_capteurs_full", (req, res) => {
  const c2Token = String(req.body.c2_id || "C2_1");
  let fList = req.body.F;
  let dList = req.body.D;

  if (!Array.isArray(fList) || !Array.isArray(dList)) {
    const capteurs = req.body.capteurs || {};
    fList = extractNumericSensorIds(capteurs.FACE || {}, "c");
    dList = extractNumericSensorIds(capteurs.DOS || {}, "dos");
  }

  fList = normalizeNumericList(fList);
  dList = normalizeNumericList(dList);

  const c2Id = extractC2NumericId(c2Token);
  if (c2Id && c2Id >= 1) {
    ensureC2(c2Id);
    c2Values[c2Id] = { F: fList, D: dList };
  }

  publishMqtt(`FormaReaEDF/C2/${c2Token}/Capteurs`, JSON.stringify({ F: fList, D: dList }));
  return res.json({ status: "ok" });
});

app.post("/api/c2/ajouter-appareil", (req, res) => {
  const name = String(req.body.name || "").trim();
  const type = String(req.body.type || "").trim().toUpperCase();
  if (!name) return res.status(400).json({ ok: false, error: "Le nom est obligatoire." });
  if (type !== "C2") return res.status(400).json({ ok: false, error: "Type invalide pour cette page." });

  const digits = name.match(/\d+/g);
  if (!digits || !digits.length) return res.status(400).json({ ok: false, error: "Numero manquant dans le nom." });
  const c2Id = Number.parseInt(digits[digits.length - 1], 10);
  if (!Number.isFinite(c2Id) || c2Id < 1 || c2Id > 99) {
    return res.status(400).json({ ok: false, error: "ID C2 invalide (1 a 99)." });
  }

  ensureC2(c2Id);
  return res.json({ ok: true });
});

app.post("/api/c2/supprimer-appareil", (req, res) => {
  const c2Id = Number.parseInt(req.body.id, 10);
  if (!Number.isFinite(c2Id) || c2Id < 1) {
    return res.status(400).json({ ok: false, error: "ID invalide." });
  }

  delete c2Names[c2Id];
  delete c2Values[c2Id];
  return res.json({ ok: true });
});

// =========================
// Startup banner
// =========================
function printStartupBanner(host, port) {
  console.log(" * Serving Node app 'server.js'");
  console.log(" * Debug mode: off");
  console.log("WARNING: Development server only. Do not use in production deployment.");
  console.log(` * Running on http://127.0.0.1:${port}`);
  if (host === "0.0.0.0") {
    console.log(` * Running on all addresses (${host})`);
  }
  console.log("Press CTRL+C to quit");
}

printStartupBanner(HOST, PORT);
app.listen(PORT, HOST);