const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const cookieParser = require("cookie-parser");
const { Server } = require("socket.io");
const Database = require("better-sqlite3");
const QRCode = require("qrcode");

const PORT = process.env.PORT || 3001;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "quizbee.db");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: "200kb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const db = new Database(DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    device_id TEXT,
    points INTEGER NOT NULL DEFAULT 0,
    total_time_ms INTEGER NOT NULL DEFAULT 0,
    last_submission_at INTEGER
  );
  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    prompt TEXT NOT NULL,
    choices_json TEXT,
    correct_answer TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    time_limit_seconds INTEGER
  );
  CREATE TABLE IF NOT EXISTS game_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    current_question_id INTEGER,
    is_open INTEGER NOT NULL DEFAULT 0,
    opened_at INTEGER,
    reveal_answer INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    team_id INTEGER NOT NULL,
    question_id INTEGER NOT NULL,
    answer TEXT NOT NULL,
    is_correct INTEGER,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    submitted_at INTEGER NOT NULL,
    ms_since_open INTEGER NOT NULL,
    UNIQUE(team_id, question_id)
  );
`);

const ensureGameState = db.prepare(
  "INSERT OR IGNORE INTO game_state (id, current_question_id, is_open, opened_at, reveal_answer) VALUES (1, NULL, 0, NULL, 0)"
);
ensureGameState.run();

function nowMs() {
  return Date.now();
}

function normalizeText(text) {
  return String(text || "").trim().toLowerCase();
}

function getGameState() {
  return db.prepare("SELECT * FROM game_state WHERE id = 1").get();
}

function getCurrentQuestion() {
  const state = getGameState();
  if (!state.current_question_id) return null;
  return db.prepare("SELECT * FROM questions WHERE id = ?").get(state.current_question_id);
}

function buildStatePayload() {
  const state = getGameState();
  const question = state.current_question_id
    ? db.prepare("SELECT * FROM questions WHERE id = ?").get(state.current_question_id)
    : null;
  return {
    current_question_id: state.current_question_id,
    is_open: !!state.is_open,
    opened_at: state.opened_at,
    reveal_answer: !!state.reveal_answer,
    question: question
      ? {
          id: question.id,
          type: question.type,
          prompt: question.prompt,
          choices: question.choices_json ? JSON.parse(question.choices_json) : null,
          correct_answer: question.correct_answer,
          points: question.points,
          time_limit_seconds: question.time_limit_seconds,
        }
      : null,
  };
}

function computeRankings() {
  const rows = db
    .prepare(
      `SELECT id, name, points, total_time_ms, last_submission_at
       FROM teams
       ORDER BY points DESC, total_time_ms ASC, last_submission_at ASC, name ASC`
    )
    .all();
  return rows;
}

function recomputeTeamStats() {
  db.prepare("UPDATE teams SET points = 0, total_time_ms = 0, last_submission_at = NULL").run();

  const rows = db
    .prepare(
      `SELECT team_id,
              SUM(points_awarded) AS points,
              SUM(ms_since_open) AS total_time_ms,
              MAX(submitted_at) AS last_submission_at
       FROM submissions
       GROUP BY team_id`
    )
    .all();

  const update = db.prepare(
    "UPDATE teams SET points = ?, total_time_ms = ?, last_submission_at = ? WHERE id = ?"
  );
  for (const row of rows) {
    update.run(row.points || 0, row.total_time_ms || 0, row.last_submission_at, row.team_id);
  }
}

function emitState() {
  io.emit("state_update", buildStatePayload());
}

function emitRankings() {
  io.emit("rankings_update", computeRankings());
}

function requireAdmin(req, res, next) {
  const provided = req.header("x-admin-password") || req.query.admin_password || "";
  if (provided !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

function ensureDeviceId(req, res, next) {
  let deviceId = req.cookies.qb_device;
  if (!deviceId) {
    deviceId = crypto.randomBytes(16).toString("hex");
    res.cookie("qb_device", deviceId, { httpOnly: true, sameSite: "lax" });
  }
  req.deviceId = deviceId;
  next();
}

function bindTeamToDevice(token, deviceId) {
  const team = db.prepare("SELECT * FROM teams WHERE token = ?").get(token);
  if (!team) {
    return { ok: false, reason: "invalid_token" };
  }
  if (team.device_id && team.device_id !== deviceId) {
    return { ok: false, reason: "in_use", team };
  }
  if (!team.device_id) {
    db.prepare("UPDATE teams SET device_id = ? WHERE id = ?").run(deviceId, team.id);
  }
  return { ok: true, team };
}

function gradeCurrentQuestion() {
  const state = getGameState();
  if (!state.current_question_id) return;

  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(state.current_question_id);
  if (!question) return;

  const submissions = db
    .prepare("SELECT * FROM submissions WHERE question_id = ? AND is_correct IS NULL")
    .all(question.id);

  const updateSubmission = db.prepare(
    "UPDATE submissions SET is_correct = ?, points_awarded = ? WHERE id = ?"
  );
  const updateTeamPoints = db.prepare("UPDATE teams SET points = points + ? WHERE id = ?");

  for (const sub of submissions) {
    let isCorrect = false;
    if (question.type === "multiple_choice") {
      isCorrect = String(sub.answer) === String(question.correct_answer);
    } else {
      isCorrect = normalizeText(sub.answer) === normalizeText(question.correct_answer);
    }
    const points = isCorrect ? question.points : 0;
    updateSubmission.run(isCorrect ? 1 : 0, points, sub.id);
    if (points !== 0) {
      updateTeamPoints.run(points, sub.team_id);
    }
  }
}

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/join/:token", ensureDeviceId, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "participant.html"));
});

app.get("/api/state", (req, res) => {
  res.json(buildStatePayload());
});

app.get("/api/qr/:token", requireAdmin, async (req, res) => {
  const token = req.params.token;
  const joinUrl = `${req.protocol}://${req.get("host")}/join/${token}`;
  try {
    const dataUrl = await QRCode.toDataURL(joinUrl);
    const base64 = dataUrl.split(",")[1];
    const img = Buffer.from(base64, "base64");
    res.setHeader("Content-Type", "image/png");
    res.send(img);
  } catch (err) {
    res.status(500).json({ error: "qr_failed" });
  }
});

app.post("/api/join/:token", ensureDeviceId, (req, res) => {
  const token = req.params.token;
  const result = bindTeamToDevice(token, req.deviceId);
  if (!result.ok) {
    return res.status(403).json({ error: result.reason });
  }
  const state = getGameState();
  let submitted = false;
  if (state.current_question_id) {
    const row = db
      .prepare("SELECT id FROM submissions WHERE team_id = ? AND question_id = ?")
      .get(result.team.id, state.current_question_id);
    submitted = !!row;
  }
  res.json({
    team: {
      id: result.team.id,
      name: result.team.name,
      token: result.team.token,
    },
    submitted_for_current: submitted,
  });
});

app.post("/api/submit", ensureDeviceId, (req, res) => {
  const { token, answer } = req.body || {};
  if (!token || typeof answer !== "string") {
    return res.status(400).json({ error: "invalid_payload" });
  }
  const result = bindTeamToDevice(token, req.deviceId);
  if (!result.ok) {
    return res.status(403).json({ error: result.reason });
  }
  const state = getGameState();
  if (!state.current_question_id || !state.is_open || !state.opened_at) {
    return res.status(400).json({ error: "question_not_open" });
  }
  const existing = db
    .prepare("SELECT id FROM submissions WHERE team_id = ? AND question_id = ?")
    .get(result.team.id, state.current_question_id);
  if (existing) {
    return res.status(409).json({ error: "already_submitted" });
  }
  const submittedAt = nowMs();
  const msSinceOpen = Math.max(0, submittedAt - state.opened_at);
  const stmt = db.prepare(
    `INSERT INTO submissions (team_id, question_id, answer, is_correct, points_awarded, submitted_at, ms_since_open)
     VALUES (?, ?, ?, NULL, 0, ?, ?)`
  );
  const info = stmt.run(result.team.id, state.current_question_id, answer, submittedAt, msSinceOpen);

  db.prepare(
    "UPDATE teams SET total_time_ms = total_time_ms + ?, last_submission_at = ? WHERE id = ?"
  ).run(msSinceOpen, submittedAt, result.team.id);

  const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(info.lastInsertRowid);
  io.emit("submission_received", submission);
  emitRankings();

  res.json({ ok: true });
});

app.get("/api/questions", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM questions ORDER BY id ASC").all();
  res.json(rows.map((q) => ({
    ...q,
    choices: q.choices_json ? JSON.parse(q.choices_json) : null,
  })));
});

app.post("/api/questions", requireAdmin, (req, res) => {
  const { type, prompt, choices, correct_answer, points, time_limit_seconds } = req.body || {};
  if (!type || !prompt || !correct_answer || typeof points !== "number") {
    return res.status(400).json({ error: "invalid_payload" });
  }
  if (type === "multiple_choice" && (!Array.isArray(choices) || choices.length !== 4)) {
    return res.status(400).json({ error: "choices_required" });
  }
  const stmt = db.prepare(
    `INSERT INTO questions (type, prompt, choices_json, correct_answer, points, time_limit_seconds)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const info = stmt.run(
    type,
    prompt,
    type === "multiple_choice" ? JSON.stringify(choices) : null,
    correct_answer,
    points,
    time_limit_seconds || null
  );
  res.json({ id: info.lastInsertRowid });
  emitState();
});

app.put("/api/questions/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const { type, prompt, choices, correct_answer, points, time_limit_seconds } = req.body || {};
  if (!id || !type || !prompt || !correct_answer || typeof points !== "number") {
    return res.status(400).json({ error: "invalid_payload" });
  }
  if (type === "multiple_choice" && (!Array.isArray(choices) || choices.length !== 4)) {
    return res.status(400).json({ error: "choices_required" });
  }
  db.prepare(
    `UPDATE questions
     SET type = ?, prompt = ?, choices_json = ?, correct_answer = ?, points = ?, time_limit_seconds = ?
     WHERE id = ?`
  ).run(
    type,
    prompt,
    type === "multiple_choice" ? JSON.stringify(choices) : null,
    correct_answer,
    points,
    time_limit_seconds || null,
    id
  );
  res.json({ ok: true });
  emitState();
});

app.delete("/api/questions/:id", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("DELETE FROM questions WHERE id = ?").run(id);
  res.json({ ok: true });
  emitState();
});

app.get("/api/teams", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM teams ORDER BY id ASC").all();
  res.json(rows);
});

app.post("/api/teams", requireAdmin, (req, res) => {
  const { team_name } = req.body || {};
  if (!team_name) {
    return res.status(400).json({ error: "invalid_payload" });
  }
  const token = crypto.randomBytes(24).toString("hex");
  const info = db
    .prepare("INSERT INTO teams (name, token) VALUES (?, ?)")
    .run(team_name, token);
  res.json({ id: info.lastInsertRowid, token });
  emitRankings();
});

app.post("/api/teams/:id/release", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE teams SET device_id = NULL WHERE id = ?").run(id);
  res.json({ ok: true });
});

app.post("/api/teams/:id/adjust", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const delta = Number(req.body?.delta || 0);
  if (!Number.isFinite(delta)) {
    return res.status(400).json({ error: "invalid_delta" });
  }
  db.prepare("UPDATE teams SET points = points + ? WHERE id = ?").run(delta, id);
  res.json({ ok: true });
  emitRankings();
});

app.post("/api/game/set_current", requireAdmin, (req, res) => {
  const questionId = Number(req.body?.question_id || 0);
  const state = getGameState();
  if (state.is_open && state.current_question_id && state.current_question_id !== questionId) {
    gradeCurrentQuestion();
    db.prepare("UPDATE game_state SET is_open = 0, opened_at = NULL").run();
  }
  db.prepare("UPDATE game_state SET current_question_id = ?, reveal_answer = 0").run(questionId || null);
  res.json({ ok: true });
  emitState();
  emitRankings();
});

app.post("/api/game/open", requireAdmin, (req, res) => {
  const state = getGameState();
  if (!state.current_question_id) {
    return res.status(400).json({ error: "no_current_question" });
  }
  db.prepare("UPDATE game_state SET is_open = 1, opened_at = ?, reveal_answer = 0").run(nowMs());
  res.json({ ok: true });
  emitState();
});

app.post("/api/game/close", requireAdmin, (req, res) => {
  gradeCurrentQuestion();
  db.prepare("UPDATE game_state SET is_open = 0").run();
  res.json({ ok: true });
  emitState();
  emitRankings();
});

app.post("/api/game/reveal", requireAdmin, (req, res) => {
  db.prepare("UPDATE game_state SET reveal_answer = 1").run();
  res.json({ ok: true });
  emitState();
});

app.post("/api/game/reset_submissions", requireAdmin, (req, res) => {
  const questionId = Number(req.body?.question_id || 0);
  if (!questionId) {
    return res.status(400).json({ error: "invalid_question" });
  }
  db.prepare("DELETE FROM submissions WHERE question_id = ?").run(questionId);
  recomputeTeamStats();
  res.json({ ok: true });
  io.emit("question_reset", { question_id: questionId });
  emitRankings();
});

app.get("/api/submissions", requireAdmin, (req, res) => {
  const questionId = Number(req.query?.question_id || 0);
  const rows = db
    .prepare(
      `SELECT submissions.*, teams.name as team_name
       FROM submissions
       JOIN teams ON teams.id = submissions.team_id
       WHERE question_id = ?
       ORDER BY submitted_at ASC`
    )
    .all(questionId);
  res.json(rows);
});

app.post("/api/submissions/:id/mark", requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  const isCorrect = req.body?.is_correct ? 1 : 0;
  const submission = db.prepare("SELECT * FROM submissions WHERE id = ?").get(id);
  if (!submission) {
    return res.status(404).json({ error: "not_found" });
  }
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(submission.question_id);
  if (!question) {
    return res.status(404).json({ error: "question_not_found" });
  }
  const newPoints = isCorrect ? question.points : 0;
  const delta = newPoints - (submission.points_awarded || 0);
  db.prepare("UPDATE submissions SET is_correct = ?, points_awarded = ? WHERE id = ?").run(
    isCorrect,
    newPoints,
    id
  );
  if (delta !== 0) {
    db.prepare("UPDATE teams SET points = points + ? WHERE id = ?").run(delta, submission.team_id);
  }
  res.json({ ok: true });
  emitRankings();
});

app.get("/api/rankings", requireAdmin, (req, res) => {
  res.json(computeRankings());
});

io.on("connection", (socket) => {
  socket.emit("state_update", buildStatePayload());
  socket.emit("rankings_update", computeRankings());
});

server.listen(PORT, () => {
  console.log(`Quiz Bee MVP running on http://localhost:${PORT}`);
});
