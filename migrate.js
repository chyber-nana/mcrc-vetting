import fs from "fs";
import { pool } from "./db.js";
async function migrate() {
  const sql = fs.readFileSync("./schema.sql", "utf8");
  await pool.query(sql);
  console.log("Database migration completed.");
  await pool.end();
}
migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
