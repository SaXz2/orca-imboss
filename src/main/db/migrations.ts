import type { Database } from "better-sqlite3";

/**
 * Ordered list of migrations. Each entry runs inside its own transaction and
 * the `user_version` pragma tracks the latest applied migration index.
 */
const MIGRATIONS: Array<(db: Database) => void> = [
  // 0 — initial schema
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS employees (
        id            INTEGER PRIMARY KEY,
        name          TEXT NOT NULL DEFAULT '',
        role          TEXT NOT NULL DEFAULT '',
        system_prompt TEXT NOT NULL DEFAULT '',
        mcp           TEXT NOT NULL DEFAULT '[]',
        skills        TEXT NOT NULL DEFAULT '[]',
        model_id        TEXT,
        thinking_level  TEXT,
        avatar          TEXT,
        disabled      INTEGER NOT NULL DEFAULT 0
      );
    `);

    // The assistant always exists, under the reserved id 0.
    db.prepare(
      "INSERT OR IGNORE INTO employees (id, name, role, system_prompt, mcp, skills, model_id, thinking_level, avatar) " +
        "VALUES (0, 'Assistant', 'Assistant', '', '[]', '[]', NULL, NULL, NULL)",
    ).run();

    db.exec(`
      -- AUTOINCREMENT keeps ids monotonic. Renderer state keyed by chat id.
      CREATE TABLE IF NOT EXISTS chats (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        title           TEXT NOT NULL DEFAULT '',
        participants    TEXT NOT NULL DEFAULT '[]',
        unread          INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        last_message_at INTEGER NOT NULL DEFAULT 0,
        from_chat_id    INTEGER,
        -- IM integration binding: which platform this conversation came from,
        -- its stable platform conversation id, and the per-conversation reply
        -- credential (e.g. the iLink context_token). All NULL for local chats.
        source          TEXT,
        source_session  TEXT,
        source_context  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_chats_created_id
        ON chats(created_at, id);

      -- Link a group chat to the user chat that spawned it (from chat link).
      CREATE INDEX IF NOT EXISTS idx_chats_from
        ON chats(from_chat_id);

      -- One app chat per (platform, session). NULL (local) chats are exempt.
      CREATE UNIQUE INDEX IF NOT EXISTS idx_chats_source_session
        ON chats(source, source_session)
        WHERE source IS NOT NULL AND source_session IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_chats_source
        ON chats(source);

      CREATE TABLE IF NOT EXISTS messages (
        id                 INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id            INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        sender_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        kind               TEXT NOT NULL DEFAULT 'text',
        content            TEXT NOT NULL,
        steps              TEXT,
        attachments        TEXT,
        created_at         INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_chat_created
        ON messages(chat_id, created_at);

      -- Full-text index over message content (external content + trigram,
      -- which supports Chinese substring search; queries need >= 3 chars).
      -- Sync triggers keep the index in lockstep with the content table;
      -- SQLite fires triggers on ON DELETE CASCADE row removal as well.
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        content='messages',
        content_rowid='id',
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF content ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, content)
        VALUES ('delete', old.id, old.content);
        INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
      END;

      CREATE TABLE IF NOT EXISTS sessions (
        employee_id         INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        chat_id             INTEGER NOT NULL REFERENCES chats(id)     ON DELETE CASCADE,
        session             TEXT NOT NULL,
        PRIMARY KEY (employee_id, chat_id)
      );

      -- Per-(employee, chat) read cursor, independent of whether an agent
      -- session exists there. The assistant reads task group chats from its
      -- root-chat session, so it needs a cursor in chats where it has no
      -- session row of its own.
      CREATE TABLE IF NOT EXISTS read_cursors (
        employee_id          INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        chat_id              INTEGER NOT NULL REFERENCES chats(id)     ON DELETE CASCADE,
        last_read_message_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (employee_id, chat_id)
      );

      CREATE TABLE IF NOT EXISTS cron_jobs (
        id           TEXT PRIMARY KEY,
        chat_id      INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
        employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        schedule     TEXT NOT NULL,
        content      TEXT NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        last_run_at  INTEGER,
        next_run_at  INTEGER
      );
    `);
  },
  // 1 — task group chats (from_chat_id IS NOT NULL) never surface their
  // `unread` counter (the chat list is root-only and group chats track reads
  // via the separate read_cursors table), so zero out any stale values left
  // behind before the write paths were guarded.
  (db) => {
    db.exec(`
      UPDATE chats SET unread = 0 WHERE from_chat_id IS NOT NULL;
    `);
  },

  // 2 — task center (kanban board)
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        title       TEXT NOT NULL,
        detail      TEXT NOT NULL DEFAULT '',
        category    TEXT NOT NULL DEFAULT '',
        flow        TEXT NOT NULL DEFAULT '',
        status      TEXT NOT NULL DEFAULT 'pending',
        assignees   TEXT NOT NULL DEFAULT '[]',
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        updated_at  INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status
        ON tasks(status, sort_order);
    `);
  },

  // 3 — task thread: timeline events, reactions, close reason
  (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN close_reason TEXT;

      CREATE TABLE IF NOT EXISTS task_events (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        actor      TEXT NOT NULL DEFAULT 'system',
        kind       TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        meta       TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
      );

      CREATE INDEX IF NOT EXISTS idx_task_events_task
        ON task_events(task_id, id);

      CREATE TABLE IF NOT EXISTS task_reactions (
        task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        actor      TEXT NOT NULL,
        kind       TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        PRIMARY KEY (task_id, actor, kind)
      );

      CREATE INDEX IF NOT EXISTS idx_task_reactions_task
        ON task_reactions(task_id);
    `);
  },

  // 4 — task references: `#id` mentions produce a directed edge between tasks
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS task_links (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        from_task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        to_task_id   INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        kind         TEXT NOT NULL DEFAULT 'references',
        created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        UNIQUE (from_task_id, to_task_id, kind)
      );

      CREATE INDEX IF NOT EXISTS idx_task_links_from
        ON task_links(from_task_id, kind);

      CREATE INDEX IF NOT EXISTS idx_task_links_to
        ON task_links(to_task_id, kind);
    `);
  },

  // 5 — promote progress-derived board cards into real tasks
  (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN progress_key TEXT;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_progress_key
        ON tasks(progress_key)
        WHERE progress_key IS NOT NULL;
    `);
  },

  // 6 — the working group chat a promoted task's people actually work in
  (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN work_chat_id INTEGER;
    `);
  },

  // 7 — department canvas: department tiles, membership (many-to-many) and links
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS departments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL DEFAULT '',
        kind       TEXT NOT NULL DEFAULT 'team',
        color      TEXT NOT NULL DEFAULT '',
        x          REAL NOT NULL DEFAULT 0,
        y          REAL NOT NULL DEFAULT 0,
        w          REAL NOT NULL DEFAULT 300,
        h          REAL NOT NULL DEFAULT 220,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER))
      );

      CREATE TABLE IF NOT EXISTS department_members (
        department_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        employee_id   INTEGER NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
        role_in_dept  TEXT NOT NULL DEFAULT '',
        is_lead       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (department_id, employee_id)
      );

      CREATE INDEX IF NOT EXISTS idx_department_members_employee
        ON department_members(employee_id);

      CREATE TABLE IF NOT EXISTS department_edges (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        from_dept_id INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        to_dept_id   INTEGER NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        label        TEXT NOT NULL DEFAULT '',
        created_at   INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        UNIQUE (from_dept_id, to_dept_id)
      );

      CREATE INDEX IF NOT EXISTS idx_department_edges_from
        ON department_edges(from_dept_id);
    `);

    const count = db.prepare("SELECT COUNT(*) AS c FROM departments").get() as {
      c: number;
    };
    if (count.c === 0) {
      db.prepare(
        "INSERT INTO departments (name, kind, x, y, w, h, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run("外包人才池", "pool", 120, 360, 300, 240, 0);
    }
  },

  // 8 — within-department reporting (the frame's internal tree) + person links
  (db) => {
    db.exec(`
      ALTER TABLE department_members ADD COLUMN reports_to INTEGER;

      CREATE TABLE IF NOT EXISTS employee_links (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        from_employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        to_employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        label            TEXT NOT NULL DEFAULT '',
        created_at       INTEGER NOT NULL DEFAULT (CAST(strftime('%s', 'now') AS INTEGER)),
        UNIQUE (from_employee_id, to_employee_id)
      );

      CREATE INDEX IF NOT EXISTS idx_employee_links_from
        ON employee_links(from_employee_id);
    `);
  },

  // 9 — generic link kinds on department links and person links
  (db) => {
    db.exec(`
      ALTER TABLE department_edges ADD COLUMN kind TEXT NOT NULL DEFAULT 'collab';
      ALTER TABLE employee_links ADD COLUMN kind TEXT NOT NULL DEFAULT 'collab';
    `);
  },

  // 10 — anchor sides on department links (which port each end attaches to)
  (db) => {
    db.exec(`
      ALTER TABLE department_edges ADD COLUMN from_side TEXT;
      ALTER TABLE department_edges ADD COLUMN to_side TEXT;
    `);
  },

  // 11 — pin legacy links to a concrete port so they stop flipping on drag
  (db) => {
    const rows = db
      .prepare(
        "SELECT id, from_dept_id, to_dept_id FROM department_edges WHERE from_side IS NULL OR to_side IS NULL",
      )
      .all() as Array<{ id: number; from_dept_id: number; to_dept_id: number }>;
    if (rows.length === 0) return;
    const depts = new Map(
      (
        db.prepare("SELECT id, x, y, w, h FROM departments").all() as Array<{
          id: number;
          x: number;
          y: number;
          w: number;
          h: number;
        }>
      ).map((d) => [d.id, d]),
    );
    const sideFor = (
      a: { x: number; y: number; w: number; h: number },
      b: { x: number; y: number; w: number; h: number },
    ): string => {
      const dx = b.x + b.w / 2 - (a.x + a.w / 2);
      const dy = b.y + b.h / 2 - (a.y + a.h / 2);
      if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "r" : "l";
      return dy >= 0 ? "b" : "t";
    };
    const update = db.prepare(
      "UPDATE department_edges SET from_side = ?, to_side = ? WHERE id = ?",
    );
    for (const row of rows) {
      const a = depts.get(row.from_dept_id);
      const b = depts.get(row.to_dept_id);
      if (!a || !b) continue;
      update.run(sideFor(a, b), sideFor(b, a), row.id);
    }
  },

  // 12 — department charter (rules/context) + the department a task belongs to
  (db) => {
    db.exec(`
      ALTER TABLE departments ADD COLUMN charter TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN department_id INTEGER;
    `);
  },

  // 13 — the department a progress message belongs to; the board task derived
  // from that message inherits it.
  (db) => {
    db.exec(`ALTER TABLE messages ADD COLUMN department_id INTEGER;`);
  },
];

export function migrate(db: Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let index = current; index < MIGRATIONS.length; index += 1) {
    const apply = db.transaction(() => {
      MIGRATIONS[index](db);
      db.pragma(`user_version = ${index + 1}`);
    });
    apply();
  }
}
