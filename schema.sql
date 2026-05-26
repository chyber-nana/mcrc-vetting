CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  round INTEGER NOT NULL CHECK (round IN (1,2,3,4)),
  category TEXT NOT NULL DEFAULT 'General',
  question_type TEXT NOT NULL CHECK (question_type IN ('multiple','short')),
  question_text TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]'::jsonb,
  correct_answer TEXT NOT NULL,
  marks INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS candidates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  round2_category TEXT,
  total_score INTEGER NOT NULL DEFAULT 0,
  total_possible INTEGER NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS candidate_round_questions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK (round IN (1,2,3,4)),
  display_order INTEGER NOT NULL,
  shuffled_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE(candidate_id, question_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  round INTEGER NOT NULL CHECK (round IN (1,2,3,4)),
  answer_text TEXT NOT NULL DEFAULT '',
  is_skipped BOOLEAN NOT NULL DEFAULT FALSE,
  is_correct BOOLEAN NOT NULL DEFAULT FALSE,
  score INTEGER NOT NULL DEFAULT 0,
  answered_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(candidate_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_questions_round_category ON questions(round, category);
CREATE INDEX IF NOT EXISTS idx_answers_candidate ON answers(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_round_questions_candidate ON candidate_round_questions(candidate_id, round);
