import crypto from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const nowIso = () => new Date().toISOString();
const publicSession = (row) => ({
  id: row.id,
  name: row.name,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastMessage: row.last_message ?? null
});
const messagePreview = (message) =>
  message?.type === 'image' ? '📷 Image' : message?.type === 'file' ? '📎 File' : (message?.body ?? null);

export function createMemoryChatStore() {
  const sessions = new Map();
  const messages = [];
  let messageId = 0;
  return {
    async close() {},
    async createSession({ name, tokenHash }) {
      const createdAt = nowIso();
      const row = {
        id: crypto.randomUUID(),
        name,
        visitor_token_hash: tokenHash,
        status: 'open',
        created_at: createdAt,
        updated_at: createdAt
      };
      sessions.set(row.id, row);
      return publicSession(row);
    },
    async verifyVisitor(id, tokenHash) {
      return sessions.get(id)?.visitor_token_hash === tokenHash;
    },
    async addMessage({
      sessionId,
      sender,
      body,
      type = 'text',
      imageUrl = null,
      fileUrl = null,
      mimeType = null,
      fileSize = null
    }) {
      const session = sessions.get(sessionId);
      if (!session) return null;
      const createdAt = nowIso();
      const row = { id: ++messageId, sessionId, sender, body, type, imageUrl, fileUrl, mimeType, fileSize, createdAt };
      messages.push(row);
      session.updated_at = createdAt;
      if (sender === 'visitor') session.status = 'open';
      return row;
    },
    async getMessages(sessionId, after = 0) {
      return messages.filter((item) => item.sessionId === sessionId && item.id > after);
    },
    async listSessions() {
      return [...sessions.values()]
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .map((row) => {
          const last = messages.filter((item) => item.sessionId === row.id).at(-1);
          return publicSession({ ...row, last_message: messagePreview(last) });
        });
    },
    async getSession(id) {
      const row = sessions.get(id);
      return row ? publicSession(row) : null;
    },
    async setStatus(id, status) {
      const row = sessions.get(id);
      if (!row) return null;
      row.status = status;
      row.updated_at = nowIso();
      return publicSession(row);
    }
  };
}

export async function createChatStore(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    console.warn('DATABASE_URL is not set; chat data will be kept in memory.');
    return createMemoryChatStore();
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id UUID PRIMARY KEY, visitor_token_hash TEXT NOT NULL,
      name VARCHAR(80) NOT NULL DEFAULT 'Visitor',
      status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGSERIAL PRIMARY KEY, session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      sender VARCHAR(16) NOT NULL CHECK (sender IN ('visitor', 'operator')),
      body VARCHAR(2000) NOT NULL,
      type VARCHAR(16) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'file')),
      image_url TEXT,
      file_url TEXT,
      mime_type VARCHAR(160),
      file_size BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS type VARCHAR(16) NOT NULL DEFAULT 'text';
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS image_url TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_url TEXT;
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(160);
    ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS file_size BIGINT;
    ALTER TABLE chat_messages DROP CONSTRAINT IF EXISTS chat_messages_type_check;
    ALTER TABLE chat_messages ADD CONSTRAINT chat_messages_type_check CHECK (type IN ('text', 'image', 'file'));
    CREATE INDEX IF NOT EXISTS chat_messages_session_id_id_idx ON chat_messages(session_id, id);
    CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions(updated_at DESC);
  `);
  console.log('Chat database schema is ready.');
  return {
    async close() {
      await pool.end();
    },
    async createSession({ name, tokenHash }) {
      const id = crypto.randomUUID();
      const { rows } = await pool.query(
        'INSERT INTO chat_sessions (id, name, visitor_token_hash) VALUES ($1, $2, $3) RETURNING *',
        [id, name, tokenHash]
      );
      return publicSession(rows[0]);
    },
    async verifyVisitor(id, tokenHash) {
      const { rowCount } = await pool.query('SELECT 1 FROM chat_sessions WHERE id = $1 AND visitor_token_hash = $2', [
        id,
        tokenHash
      ]);
      return rowCount === 1;
    },
    async addMessage({
      sessionId,
      sender,
      body,
      type = 'text',
      imageUrl = null,
      fileUrl = null,
      mimeType = null,
      fileSize = null
    }) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'INSERT INTO chat_messages (session_id, sender, body, type, image_url, file_url, mime_type, file_size) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, session_id AS "sessionId", sender, body, type, image_url AS "imageUrl", file_url AS "fileUrl", mime_type AS "mimeType", file_size AS "fileSize", created_at AS "createdAt"',
          [sessionId, sender, body, type, imageUrl, fileUrl, mimeType, fileSize]
        );
        await client.query(
          "UPDATE chat_sessions SET updated_at = NOW(), status = CASE WHEN $2 = 'visitor' THEN 'open' ELSE status END WHERE id = $1",
          [sessionId, sender]
        );
        await client.query('COMMIT');
        return rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        if (error.code === '23503') return null;
        throw error;
      } finally {
        client.release();
      }
    },
    async getMessages(sessionId, after = 0) {
      const { rows } = await pool.query(
        'SELECT id, session_id AS "sessionId", sender, body, type, image_url AS "imageUrl", file_url AS "fileUrl", mime_type AS "mimeType", file_size AS "fileSize", created_at AS "createdAt" FROM chat_messages WHERE session_id = $1 AND id > $2 ORDER BY id ASC LIMIT 500',
        [sessionId, after]
      );
      return rows;
    },
    async listSessions() {
      const { rows } = await pool.query(
        "SELECT s.*, (SELECT CASE WHEN m.type = 'image' THEN '📷 Image' WHEN m.type = 'file' THEN '📎 File' ELSE m.body END FROM chat_messages m WHERE m.session_id = s.id ORDER BY m.id DESC LIMIT 1) AS last_message FROM chat_sessions s ORDER BY s.updated_at DESC LIMIT 200"
      );
      return rows.map(publicSession);
    },
    async getSession(id) {
      const { rows } = await pool.query('SELECT * FROM chat_sessions WHERE id = $1', [id]);
      return rows[0] ? publicSession(rows[0]) : null;
    },
    async setStatus(id, status) {
      const { rows } = await pool.query(
        'UPDATE chat_sessions SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
        [id, status]
      );
      return rows[0] ? publicSession(rows[0]) : null;
    }
  };
}
