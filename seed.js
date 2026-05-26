import fs from "fs";
import { pool } from "./db.js";

const questions = JSON.parse(fs.readFileSync("./questions.seed.json", "utf8"));

async function seed() {
  await pool.query(`
    INSERT INTO settings (key, value)
    VALUES (
      'round_config',
      '{"1":{"questionCount":25,"marks":25,"timeMinutes":25},"2":{"questionCount":15,"marks":15,"timeMinutes":10},"3":{"questionCount":5,"marks":5,"timeMinutes":5},"4":{"questionCount":5,"marks":5,"timeMinutes":5}}'::jsonb
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
  `);

  const existing = await pool.query("SELECT COUNT(*)::int AS count FROM questions");
  if (existing.rows[0].count > 0) {
    console.log("Questions already exist. Seed skipped to avoid duplicates.");
    await pool.end();
    return;
  }

  for (const q of questions) {
    await pool.query(
      `INSERT INTO questions (round, category, question_type, question_text, options, correct_answer, marks)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [q.round, q.category, q.question_type, q.question_text, JSON.stringify(q.options || []), q.correct_answer, q.marks || 1]
    );
  }

  console.log(`Seeded ${questions.length} questions and default settings.`);
  await pool.end();
}
seed().catch((error) => {
  console.error("Seeding failed:", error);
  process.exit(1);
});
