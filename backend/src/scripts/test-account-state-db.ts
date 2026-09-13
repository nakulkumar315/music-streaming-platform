import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const PASSWORD = "ArtistAccountState123!";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run account-state DB tests with NODE_ENV=production");
  }

  const testDatabaseUrl = String(process.env.AUTH_TEST_DATABASE_URL || "").trim();
  if (!testDatabaseUrl) {
    throw new Error(
      "AUTH_TEST_DATABASE_URL is required. Use a disposable migrated test database; never point this script at production."
    );
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "auth-account-state-test-secret-not-for-real-environments";

  const [
    { pool },
    { SessionService },
    { requireAuth },
    { AuthService },
    { ArtistAccountStateService },
  ] = await Promise.all([
    import("../common/db"),
    import("../common/auth/session.service"),
    import("../common/auth/requireAuth"),
    import("../modules/auth/auth.service"),
    import("../common/auth/account-state.service"),
  ]);

  const authService = new AuthService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userIds: number[] = [];
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  const createArtist = async (label: string) => {
    const email = `artist-state-${label}-${suffix}@example.invalid`;
    const result = await pool.query(
      `INSERT INTO users (email, password, role, status, is_deleted, name, artist_status, is_verified)
       VALUES ($1, $2, 'ARTIST', 'ACTIVE', false, 'Artist State Test', 'APPROVED', true)
       RETURNING id, email`,
      [email, passwordHash]
    );
    const id = Number(result.rows[0].id);
    userIds.push(id);
    return { id, email };
  };

  const tokenFor = (user: { id: number; email: string }, sessionId: number) =>
    jwt.sign(
      { id: user.id, email: user.email, role: "ARTIST", sid: sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: "1d" }
    );

  const invokeAuth = async (token: string) => {
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    let statusCode = 200;
    let nextCalled = false;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };
    await requireAuth(req, res, () => {
      nextCalled = true;
    });
    return { statusCode, nextCalled };
  };

  try {
    const artistA = await createArtist("delete-reactivate");
    const a1 = await SessionService.createSession({
      userId: artistA.id,
      deviceId: "artist-state-a1",
      maxActiveSessions: 2,
    });
    const a2 = await SessionService.createSession({
      userId: artistA.id,
      deviceId: "artist-state-a2",
      maxActiveSessions: 2,
    });
    const a1Token = tokenFor(artistA, a1.id);
    const a2Token = tokenFor(artistA, a2.id);

    const deleted = await ArtistAccountStateService.softDelete(artistA.id, "Security test delete");
    assert.equal(deleted.isDeleted, true);
    assert.equal(deleted.sessionsRevoked, 2, "Soft delete must revoke every active artist session");
    assert.equal((await SessionService.listSessions(artistA.id)).length, 0);
    assert.equal((await invokeAuth(a1Token)).statusCode, 401, "Soft-deleted artist token must be revoked");
    assert.equal((await invokeAuth(a2Token)).statusCode, 401, "All soft-deleted artist tokens must be revoked");

    const reactivated = await ArtistAccountStateService.reactivate(artistA.id);
    assert.equal(reactivated.status, "ACTIVE");
    assert.equal(reactivated.isDeleted, false);
    assert.equal((await SessionService.listSessions(artistA.id)).length, 0, "Reactivation must not restore old sessions");
    assert.equal((await invokeAuth(a1Token)).statusCode, 401, "Old token must remain invalid after reactivation");

    const freshAfterReactivate = await SessionService.createSession({
      userId: artistA.id,
      deviceId: "artist-state-a3",
      maxActiveSessions: 2,
    });
    const freshToken = tokenFor(artistA, freshAfterReactivate.id);
    assert.equal((await invokeAuth(freshToken)).nextCalled, true, "Artist may authenticate again only through a fresh session");

    const suspended = await ArtistAccountStateService.toggleSuspension(artistA.id);
    assert.equal(suspended.status, "SUSPENDED");
    assert.equal(suspended.sessionsRevoked, 1, "Suspension must revoke the active session");
    assert.equal((await invokeAuth(freshToken)).statusCode, 401);

    const activated = await ArtistAccountStateService.toggleSuspension(artistA.id);
    assert.equal(activated.status, "ACTIVE");
    assert.equal((await SessionService.listSessions(artistA.id)).length, 0, "Activation must not revive pre-suspension sessions");
    assert.equal((await invokeAuth(freshToken)).statusCode, 401);

    const preBanSession = await SessionService.createSession({
      userId: artistA.id,
      deviceId: "artist-state-a4",
      maxActiveSessions: 2,
    });
    const preBanToken = tokenFor(artistA, preBanSession.id);
    const banned = await ArtistAccountStateService.ban(artistA.id);
    assert.equal(banned.status, "BANNED");
    assert.equal(banned.sessionsRevoked, 1, "Ban must revoke the active artist session");
    assert.equal((await invokeAuth(preBanToken)).statusCode, 401);

    const unbanned = await ArtistAccountStateService.reactivate(artistA.id);
    assert.equal(unbanned.status, "ACTIVE");
    assert.equal((await SessionService.listSessions(artistA.id)).length, 0);
    assert.equal((await invokeAuth(preBanToken)).statusCode, 401, "Banned token must stay invalid after explicit reactivation");

    // Race an ordinary login with soft-delete. Both operations lock the user row
    // before session mutation, so either login commits first and is immediately
    // revoked by deletion, or deletion commits first and login fails closed.
    const artistB = await createArtist("delete-race");
    const racingLogin = authService
      .login(artistB.email, PASSWORD, "artist-state-race-login", "Delete race")
      .then((value: any) => ({ ok: true as const, value }))
      .catch((error: any) => ({ ok: false as const, error }));
    const racingDelete = ArtistAccountStateService.softDelete(artistB.id, "Concurrent delete test");

    const [loginResult, deleteResult] = await Promise.all([racingLogin, racingDelete]);
    assert.equal(deleteResult.isDeleted, true);
    assert.equal((await SessionService.listSessions(artistB.id)).length, 0, "No session may survive delete/login race");

    if (loginResult.ok) {
      assert.equal(
        (await invokeAuth(String(loginResult.value.token))).statusCode,
        401,
        "A login that wins before deletion must still be revoked by deletion"
      );
    } else {
      const errorCode = (loginResult as any).error?.code;
      assert.ok(
        errorCode === "ACCOUNT_INACTIVE" || errorCode === "INVALID_CREDENTIALS",
        "If deletion wins first, concurrent login must fail closed"
      );
    }

    await ArtistAccountStateService.reactivate(artistB.id);
    assert.equal((await SessionService.listSessions(artistB.id)).length, 0, "Reactivation after raced deletion must still require fresh login");

    console.log("Artist account-state DB integration checks passed.");
  } finally {
    if (userIds.length > 0) {
      await pool.query("DELETE FROM user_sessions WHERE user_id = ANY($1::int[])", [userIds]).catch(() => undefined);
      await pool.query("DELETE FROM users WHERE id = ANY($1::int[])", [userIds]).catch(() => undefined);
    }
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
