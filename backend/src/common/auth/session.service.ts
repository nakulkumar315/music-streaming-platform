import { PoolClient } from "pg";
import { pool } from "../db";

const SESSION_TTL_HOURS = 24;
const DEFAULT_MAX_ACTIVE_SESSIONS = 2;

export type CreateSessionInput = {
  userId: number;
  deviceId: string;
  deviceName?: string | null;
  maxActiveSessions?: number | null;
};

export type CreatedSession = {
  id: number;
  userId: number;
  deviceId: string;
};

export function normalizeDeviceId(deviceId: string) {
  const value = String(deviceId || "").trim();
  if (!value || value === "Unknown-ID") {
    const error: any = new Error("A stable device identifier is required");
    error.status = 400;
    error.code = "DEVICE_ID_REQUIRED";
    throw error;
  }
  if (value.length > 255) {
    const error: any = new Error("Device identifier is invalid");
    error.status = 400;
    error.code = "INVALID_DEVICE_ID";
    throw error;
  }
  return value;
}

async function createSessionWithClient(
  client: PoolClient,
  {
    userId,
    deviceId,
    deviceName,
    maxActiveSessions = DEFAULT_MAX_ACTIVE_SESSIONS,
  }: CreateSessionInput
): Promise<CreatedSession> {
  if (!Number.isInteger(userId) || userId <= 0) {
    const error: any = new Error("Invalid user");
    error.status = 400;
    error.code = "INVALID_USER";
    throw error;
  }

  const normalizedDeviceId = normalizeDeviceId(deviceId);

  await client.query("SELECT pg_advisory_xact_lock($1)", [userId]);

  await client.query(
    `DELETE FROM user_sessions
      WHERE user_id = $1
        AND created_at <= now() - ($2 * interval '1 hour')`,
    [userId, SESSION_TTL_HOURS]
  );

  // Re-login on the same physical/browser device rotates the server session,
  // invalidating any previously issued JWT for that device immediately.
  await client.query(
    "DELETE FROM user_sessions WHERE user_id = $1 AND device_id = $2",
    [userId, normalizedDeviceId]
  );

  if (maxActiveSessions !== null) {
    const countResult = await client.query(
      "SELECT COUNT(*)::int AS count FROM user_sessions WHERE user_id = $1",
      [userId]
    );
    const activeCount = Number(countResult.rows?.[0]?.count ?? 0);

    if (activeCount >= maxActiveSessions) {
      const error: any = new Error("Device limit reached");
      error.status = 403;
      error.code = "DEVICE_LIMIT_REACHED";
      throw error;
    }
  }

  const inserted = await client.query(
    `INSERT INTO user_sessions (user_id, device_id, device_name, last_active_at)
     VALUES ($1, $2, $3, now())
     RETURNING id, user_id, device_id`,
    [userId, normalizedDeviceId, deviceName?.trim() || null]
  );

  const row = inserted.rows[0];
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    deviceId: String(row.device_id),
  };
}

export class SessionService {
  static async createSession(input: CreateSessionInput): Promise<CreatedSession> {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      const created = await createSessionWithClient(client, input);
      await client.query("COMMIT");
      return created;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static async createSessionInTransaction(
    client: PoolClient,
    input: CreateSessionInput
  ): Promise<CreatedSession> {
    return createSessionWithClient(client, input);
  }

  static async assertActiveSession(sessionId: number, userId: number) {
    if (!Number.isInteger(sessionId) || sessionId <= 0) return false;

    const result = await pool.query(
      `UPDATE user_sessions
          SET last_active_at = now()
        WHERE id = $1
          AND user_id = $2
          AND created_at > now() - ($3 * interval '1 hour')
      RETURNING id`,
      [sessionId, userId, SESSION_TTL_HOURS]
    );

    return result.rowCount === 1;
  }

  static async listSessions(userId: number, currentSessionId?: number) {
    const result = await pool.query(
      `SELECT id, device_id, device_name, last_active_at, created_at
         FROM user_sessions
        WHERE user_id = $1
          AND created_at > now() - ($2 * interval '1 hour')
        ORDER BY last_active_at DESC`,
      [userId, SESSION_TTL_HOURS]
    );

    return result.rows.map((row) => ({
      id: Number(row.id),
      deviceId: String(row.device_id),
      deviceName: row.device_name ? String(row.device_name) : null,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
      current: currentSessionId !== undefined && Number(row.id) === currentSessionId,
    }));
  }

  static async revokeSession(userId: number, sessionId: number) {
    const result = await pool.query(
      "DELETE FROM user_sessions WHERE user_id = $1 AND id = $2 RETURNING id",
      [userId, sessionId]
    );
    return result.rowCount === 1;
  }

  static async revokeDeviceSession(userId: number, deviceId: string) {
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const result = await pool.query(
      "DELETE FROM user_sessions WHERE user_id = $1 AND device_id = $2 RETURNING id",
      [userId, normalizedDeviceId]
    );
    return result.rowCount === 1;
  }

  static async revokeAllSessions(userId: number) {
    await pool.query("DELETE FROM user_sessions WHERE user_id = $1", [userId]);
  }
}
