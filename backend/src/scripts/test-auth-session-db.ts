import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const CURRENT_PASSWORD = "AuthCurrentPassword123!";
const NEW_PASSWORD = "AuthNewPassword456!";
const TEST_CORRELATION_ID = "00000000-0000-4000-8000-000000000003";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run auth DB tests with NODE_ENV=production");
  }

  const testDatabaseUrl = String(process.env.AUTH_TEST_DATABASE_URL || "").trim();
  if (!testDatabaseUrl) {
    throw new Error(
      "AUTH_TEST_DATABASE_URL is required. Use a disposable migrated test database; never point this script at production."
    );
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "auth-integration-test-secret-not-for-real-environments";

  const [
    { pool },
    { SessionService },
    { requireAuth },
    { AuthService },
    { updatePasswordAndRotateSession },
  ] = await Promise.all([
    import("../common/db"),
    import("../common/auth/session.service"),
    import("../common/auth/requireAuth"),
    import("../modules/auth/auth.service"),
    import("../modules/user/password.controller"),
  ]);
  const authService = new AuthService();

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userIds: number[] = [];
  const passwordHash = await bcrypt.hash(CURRENT_PASSWORD, 10);

  const createUser = async (role = "FAN") => {
    const email = `auth-test-${suffix}-${userIds.length}@example.invalid`;
    const result = await pool.query(
      `INSERT INTO users (email, password, role, status, is_deleted, name)
       VALUES ($1, $2, $3, 'ACTIVE', false, 'Auth Test')
       RETURNING id, email`,
      [email, passwordHash, role]
    );
    const id = Number(result.rows[0].id);
    userIds.push(id);
    return { id, email };
  };

  const tokenFor = (user: { id: number; email: string }, sessionId: number, role = "FAN") =>
    jwt.sign(
      { id: user.id, email: user.email, role, sid: sessionId },
      process.env.JWT_SECRET!,
      { expiresIn: "1d" }
    );

  const invokeAuth = async (token: string) => {
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    let statusCode = 200;
    let body: any = null;
    let nextCalled = false;
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        body = payload;
        return this;
      },
    };

    await requireAuth(req, res, () => {
      nextCalled = true;
    });
    return { req, statusCode, body, nextCalled };
  };

  const invokePasswordChange = async (input: {
    userId: number;
    oldPassword: string;
    newPassword: string;
    deviceId: string;
  }) => {
    let statusCode = 200;
    let body: any = null;
    const req: any = {
      user: { id: input.userId },
      body: {
        oldPassword: input.oldPassword,
        newPassword: input.newPassword,
        deviceId: input.deviceId,
      },
      headers: { "user-agent": "Auth DB integration test" },
      correlationId: TEST_CORRELATION_ID,
    };
    const res: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: any) {
        body = payload;
        return this;
      },
    };

    await updatePasswordAndRotateSession(req, res);
    return { statusCode, body };
  };

  try {
    const userA = await createUser("FAN");

    const device1 = await SessionService.createSession({
      userId: userA.id,
      deviceId: "auth-test-device-1",
      deviceName: "Device 1",
      maxActiveSessions: 2,
    });

    const finalSlotRace = await Promise.allSettled([
      SessionService.createSession({
        userId: userA.id,
        deviceId: "auth-test-device-2",
        deviceName: "Device 2",
        maxActiveSessions: 2,
      }),
      SessionService.createSession({
        userId: userA.id,
        deviceId: "auth-test-device-3",
        deviceName: "Device 3",
        maxActiveSessions: 2,
      }),
    ]);
    assert.equal(
      finalSlotRace.filter((result) => result.status === "fulfilled").length,
      1,
      "Exactly one concurrent final-slot login must succeed"
    );
    assert.equal(
      finalSlotRace.filter((result) => result.status === "rejected").length,
      1,
      "Exactly one concurrent final-slot login must be rejected"
    );

    const activeAfterRace = await SessionService.listSessions(userA.id, device1.id);
    assert.equal(activeAfterRace.length, 2, "Device limit must remain exactly two after race");

    const winningOther = activeAfterRace.find((session) => session.deviceId !== "auth-test-device-1");
    assert.ok(winningOther, "One second device must remain active");

    const rotated = await SessionService.createSession({
      userId: userA.id,
      deviceId: winningOther!.deviceId,
      deviceName: "Rotated device",
      maxActiveSessions: 2,
    });
    assert.notEqual(rotated.id, winningOther!.id, "Same-device retry must rotate session id");
    assert.equal(
      await SessionService.assertActiveSession(winningOther!.id, userA.id),
      false,
      "Old same-device session must be revoked after rotation"
    );
    assert.equal(
      (await SessionService.listSessions(userA.id, rotated.id)).length,
      2,
      "Same-device retry must not increase active session count"
    );

    const token = tokenFor(userA, device1.id);
    assert.equal((await invokeAuth(token)).nextCalled, true, "Active token must reach protected API");

    await SessionService.revokeSession(userA.id, device1.id);
    const afterLogout = await invokeAuth(token);
    assert.equal(afterLogout.nextCalled, false, "Revoked token must not reach protected API");
    assert.equal(afterLogout.statusCode, 401, "Revoked token must return 401");

    const userB = await createUser("FAN");
    const userBSession = await SessionService.createSession({
      userId: userB.id,
      deviceId: "auth-test-user-b-device",
      maxActiveSessions: 2,
    });
    assert.equal(
      await SessionService.revokeSession(userA.id, userBSession.id),
      false,
      "User A must not revoke User B session by pasted session id"
    );
    assert.equal(
      await SessionService.assertActiveSession(userBSession.id, userB.id),
      true,
      "User B session must remain active after User A IDOR attempt"
    );

    const suspensionSession = await SessionService.createSession({
      userId: userA.id,
      deviceId: "auth-test-suspension-device",
      maxActiveSessions: 2,
    });
    const suspensionToken = tokenFor(userA, suspensionSession.id);

    await pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userA.id]);
    const suspended = await invokeAuth(suspensionToken);
    assert.equal(suspended.statusCode, 403, "Suspended account must fail closed");
    assert.equal(suspended.nextCalled, false);

    await pool.query("UPDATE users SET status = 'ACTIVE', is_deleted = true WHERE id = $1", [userA.id]);
    const deleted = await invokeAuth(suspensionToken);
    assert.equal(deleted.statusCode, 403, "Deleted account must fail closed");
    assert.equal(deleted.nextCalled, false);

    const userC = await createUser("FAN");
    const c1 = await SessionService.createSession({
      userId: userC.id,
      deviceId: "auth-test-c1",
      maxActiveSessions: 2,
    });
    const c2 = await SessionService.createSession({
      userId: userC.id,
      deviceId: "auth-test-c2",
      maxActiveSessions: 2,
    });
    assert.equal(await SessionService.revokeSession(userC.id, c1.id), true);
    assert.equal(await SessionService.assertActiveSession(c1.id, userC.id), false);
    assert.equal(await SessionService.assertActiveSession(c2.id, userC.id), true);

    const userD = await createUser("FAN");
    const d1 = await SessionService.createSession({
      userId: userD.id,
      deviceId: "auth-test-password-d1",
      maxActiveSessions: 2,
    });
    const d2 = await SessionService.createSession({
      userId: userD.id,
      deviceId: "auth-test-password-d2",
      maxActiveSessions: 2,
    });
    const oldD1Token = tokenFor(userD, d1.id);
    const oldD2Token = tokenFor(userD, d2.id);
    assert.equal((await invokeAuth(oldD1Token)).nextCalled, true);
    assert.equal((await invokeAuth(oldD2Token)).nextCalled, true);

    const changed = await invokePasswordChange({
      userId: userD.id,
      oldPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
      deviceId: "auth-test-password-current",
    });
    assert.equal(changed.statusCode, 200, "Password change must succeed with the current password");
    assert.equal(changed.body?.sessionRotated, true, "Password change must report session rotation");
    assert.equal(typeof changed.body?.token, "string", "Password change must return replacement JWT");

    assert.equal((await invokeAuth(oldD1Token)).statusCode, 401, "First pre-change token must be revoked");
    assert.equal((await invokeAuth(oldD2Token)).statusCode, 401, "Second pre-change token must be revoked");
    assert.equal(
      (await invokeAuth(String(changed.body.token))).nextCalled,
      true,
      "Replacement password-change token must be immediately usable"
    );

    const passwordRow = await pool.query("SELECT password FROM users WHERE id = $1", [userD.id]);
    assert.equal(await bcrypt.compare(NEW_PASSWORD, String(passwordRow.rows[0].password)), true);
    assert.equal(await bcrypt.compare(CURRENT_PASSWORD, String(passwordRow.rows[0].password)), false);

    const dSessions = await SessionService.listSessions(userD.id);
    assert.equal(dSessions.length, 1, "Password change must leave exactly one replacement session");
    assert.equal(dSessions[0].deviceId, "auth-test-password-current");

    // Password change and an old-password login deliberately race. Because both
    // take the same user-row lock before the session advisory lock, either login
    // finishes first and its session is then revoked by password change, or
    // password change finishes first and the old password is rejected. The
    // forbidden outcome is an old-password session surviving afterward.
    const userE = await createUser("FAN");
    const oldPasswordLogin = authService
      .login(userE.email, CURRENT_PASSWORD, "auth-test-race-old-login", "Old password race")
      .then((value: any) => ({ ok: true as const, value }))
      .catch((error: any) => ({ ok: false as const, error }));
    const passwordRaceChange = invokePasswordChange({
      userId: userE.id,
      oldPassword: CURRENT_PASSWORD,
      newPassword: NEW_PASSWORD,
      deviceId: "auth-test-race-current",
    });

    const [raceLoginResult, racePasswordResult] = await Promise.all([
      oldPasswordLogin,
      passwordRaceChange,
    ]);
    assert.equal(racePasswordResult.statusCode, 200, "Concurrent password rotation must complete");

    const raceSessions = await SessionService.listSessions(userE.id);
    assert.equal(raceSessions.length, 1, "Only the password-change replacement session may survive the race");
    assert.equal(raceSessions[0].deviceId, "auth-test-race-current");

    if (raceLoginResult.ok) {
      const racedOldToken = String(raceLoginResult.value.token);
      assert.equal(
        (await invokeAuth(racedOldToken)).statusCode,
        401,
        "A login that authenticated with the old password before rotation must be revoked by rotation"
      );
    } else {
      assert.equal(
        raceLoginResult.error?.code,
        "INVALID_CREDENTIALS",
        "If password rotation wins the lock, the old-password login must be rejected"
      );
    }

    // JWT role claims are never authorization truth. Current DB role wins.
    const userF = await createUser("FAN");
    const fSession = await SessionService.createSession({
      userId: userF.id,
      deviceId: "auth-test-forged-role",
      maxActiveSessions: 2,
    });
    const forgedAdminClaim = tokenFor(userF, fSession.id, "ADMIN");
    const resolvedForged = await invokeAuth(forgedAdminClaim);
    assert.equal(resolvedForged.nextCalled, true);
    assert.equal(resolvedForged.req.user?.role, "FAN", "Current DB role must override JWT role claim");

    console.log("Auth DB integration checks passed.");
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
