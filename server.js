import express from "express";
import cors from "cors";
import helmet from "helmet";
import dotenv from "dotenv";
import { query, pool } from "./db.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 10000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";

app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(",") : true,
  credentials: true,
}));
app.use(express.json({ limit: "1mb" }));

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function normalize(value) {
  return String(value || "").trim().toLowerCase();
}
function requireAdmin(req, res, next) {
  const password = req.headers["x-admin-password"];
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: "Unauthorized admin request." });
  next();
}

app.get("/", (_req, res) => res.json({ ok: true, service: "MCRC Vetting Backend" }));

app.get("/api/settings", async (_req, res) => {
  const result = await query("SELECT value FROM settings WHERE key = 'round_config'");
  res.json(result.rows[0]?.value || {});
});

app.get("/api/categories", async (_req, res) => {
  const result = await query("SELECT DISTINCT category FROM questions WHERE round = 2 AND is_active = TRUE ORDER BY category");
  res.json(result.rows.map((r) => r.category));
});

app.post("/api/candidates/start", async (req, res) => {
  const { fullName, round2Category } = req.body;
  if (!fullName || !String(fullName).trim()) return res.status(400).json({ error: "Full name is required." });
  if (!round2Category) return res.status(400).json({ error: "Round 2 category is required." });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const candidateResult = await client.query(
      "INSERT INTO candidates (full_name, round2_category) VALUES ($1,$2) RETURNING *",
      [String(fullName).trim(), round2Category]
    );
    const candidate = candidateResult.rows[0];
    const configs = (await client.query("SELECT value FROM settings WHERE key = 'round_config'")).rows[0].value;

    for (const round of [1, 2, 3, 4]) {
      let questionQuery = "SELECT * FROM questions WHERE round = $1 AND is_active = TRUE";
      const params = [round];
      if (round === 2) {
        questionQuery += " AND category = $2";
        params.push(round2Category);
      }
      const qResult = await client.query(questionQuery, params);
      const count = configs[String(round)]?.questionCount || qResult.rows.length;
      const selected = shuffle(qResult.rows).slice(0, count);
      if (selected.length < count) throw new Error(`Not enough questions configured for Round ${round}.`);

      for (let i = 0; i < selected.length; i += 1) {
        const q = selected[i];
        const shuffledOptions = q.question_type === "multiple" ? shuffle(q.options || []) : [];
        await client.query(
          `INSERT INTO candidate_round_questions
           (candidate_id, question_id, round, display_order, shuffled_options)
           VALUES ($1,$2,$3,$4,$5)`,
          [candidate.id, q.id, round, i + 1, JSON.stringify(shuffledOptions)]
        );
      }
    }
    await client.query("COMMIT");
    res.status(201).json({ candidateId: candidate.id });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: error.message || "Could not start candidate session." });
  } finally {
    client.release();
  }
});

app.get("/api/candidates/:candidateId/questions/:round", async (req, res) => {
  const { candidateId, round } = req.params;
  const result = await query(
    `SELECT q.id, q.round, q.category, q.question_type AS "questionType",
            q.question_text AS "questionText", q.marks,
            crq.display_order AS "displayOrder", crq.shuffled_options AS options
     FROM candidate_round_questions crq
     JOIN questions q ON q.id = crq.question_id
     WHERE crq.candidate_id = $1 AND crq.round = $2
     ORDER BY crq.display_order`,
    [candidateId, Number(round)]
  );
  res.json(result.rows);
});

app.post("/api/candidates/:candidateId/answers", async (req, res) => {
  const { candidateId } = req.params;
  const { questionId, answerText = "", isSkipped = false } = req.body;
  if (!questionId) return res.status(400).json({ error: "Question ID is required." });

  const qResult = await query("SELECT id, round, correct_answer, marks FROM questions WHERE id = $1", [questionId]);
  const q = qResult.rows[0];
  if (!q) return res.status(404).json({ error: "Question not found." });

  const isCorrect = !isSkipped && normalize(answerText) === normalize(q.correct_answer);
  const score = isCorrect ? Number(q.marks || 1) : 0;

  await query(
    `INSERT INTO answers (candidate_id, question_id, round, answer_text, is_skipped, is_correct, score)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (candidate_id, question_id)
     DO UPDATE SET answer_text = EXCLUDED.answer_text,
                   is_skipped = EXCLUDED.is_skipped,
                   is_correct = EXCLUDED.is_correct,
                   score = EXCLUDED.score,
                   answered_at = NOW()`,
    [candidateId, questionId, q.round, answerText, Boolean(isSkipped), isCorrect, score]
  );
  res.json({ saved: true });
});

app.post("/api/candidates/:candidateId/finish", async (req, res) => {
  const { candidateId } = req.params;
  const scoreResult = await query("SELECT COALESCE(SUM(score),0)::int AS total_score FROM answers WHERE candidate_id = $1", [candidateId]);
  const totalScore = scoreResult.rows[0].total_score;
  const updateResult = await query(
    `UPDATE candidates
     SET total_score = $1, total_possible = 50, status = 'completed', completed_at = NOW()
     WHERE id = $2
     RETURNING id, full_name, total_score, total_possible, status`,
    [totalScore, candidateId]
  );
  res.json(updateResult.rows[0]);
});

app.get("/api/admin/questions", requireAdmin, async (req, res) => {
  const { round, category } = req.query;
  const params = [];
  let sql = "SELECT * FROM questions WHERE is_active = TRUE";
  if (round) { params.push(Number(round)); sql += ` AND round = $${params.length}`; }
  if (category) { params.push(category); sql += ` AND category = $${params.length}`; }
  sql += " ORDER BY round, category, created_at";
  const result = await query(sql, params);
  res.json(result.rows);
});

app.post("/api/admin/questions", requireAdmin, async (req, res) => {
  const { round, category = "General", questionType, questionText, options = [], correctAnswer, marks = 1 } = req.body;
  const result = await query(
    `INSERT INTO questions (round, category, question_type, question_text, options, correct_answer, marks)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [round, category, questionType, questionText, JSON.stringify(options), correctAnswer, marks]
  );
  res.status(201).json(result.rows[0]);
});

app.put("/api/admin/questions/:id", requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { round, category, questionType, questionText, options, correctAnswer, marks } = req.body;
  const result = await query(
    `UPDATE questions
     SET round = $1, category = $2, question_type = $3, question_text = $4,
         options = $5, correct_answer = $6, marks = $7, updated_at = NOW()
     WHERE id = $8 RETURNING *`,
    [round, category, questionType, questionText, JSON.stringify(options || []), correctAnswer, marks, id]
  );
  res.json(result.rows[0]);
});

app.delete("/api/admin/questions/:id", requireAdmin, async (req, res) => {
  await query("UPDATE questions SET is_active = FALSE WHERE id = $1", [req.params.id]);
  res.json({ deleted: true });
});

app.get("/api/admin/leaderboard", requireAdmin, async (_req, res) => {
  const result = await query(
    `SELECT id, full_name AS "fullName", round2_category AS "round2Category",
            total_score AS "totalScore", total_possible AS "totalPossible",
            status, started_at AS "startedAt", completed_at AS "completedAt"
     FROM candidates
     WHERE status = 'completed'
     ORDER BY total_score DESC, completed_at ASC`
  );
  res.json(result.rows);
});

app.get("/api/admin/candidates/:id", requireAdmin, async (req, res) => {
  const candidateResult = await query(
    `SELECT id, full_name AS "fullName", round2_category AS "round2Category",
            total_score AS "totalScore", total_possible AS "totalPossible",
            status, started_at AS "startedAt", completed_at AS "completedAt"
     FROM candidates WHERE id = $1`,
    [req.params.id]
  );
  const answersResult = await query(
    `SELECT a.round, a.answer_text AS "answerText", a.is_skipped AS "isSkipped",
            a.is_correct AS "isCorrect", a.score, q.question_text AS "questionText",
            q.correct_answer AS "correctAnswer", q.marks
     FROM answers a
     JOIN questions q ON q.id = a.question_id
     WHERE a.candidate_id = $1
     ORDER BY a.round, a.answered_at`,
    [req.params.id]
  );
  res.json({ candidate: candidateResult.rows[0], answers: answersResult.rows });
});

app.put("/api/admin/settings", requireAdmin, async (req, res) => {
  const { roundConfig } = req.body;
  await query(
    `INSERT INTO settings (key, value)
     VALUES ('round_config', $1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(roundConfig)]
  );
  res.json({ saved: true });
});

app.listen(PORT, () => console.log(`MCRC Vetting backend running on port ${PORT}`));
