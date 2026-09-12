import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

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

  const [{ pool }, { SessionService }, { requireAuth }] = await Promise.all([
    import("../common/db"),
    import("../common/auth/session.service"),
    import("../common/auth/requireAuth"),
  ]);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userIds: number[] = [];

  const createUser = async (role = "FAN") => {
    const email = `auth-test-${suffix}-${userIds.length}@example.invalid`;
    const result = await pool.query(
      `INSERT INTO users (email, password, role, status, is_deleted, name)
       VALUES ($1, 'test-password-hash', $2, 'ACTIVE', false, 'Auth Test')
       RETURNING id, email`,
      [email, role]
    );
    const id = Number(result.rows[0].id);
    userIds.push(id);
    return { id, email };
  };

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

  try {
    const userA = await createUser("FAN");

    const device1 = await SessionService.createSession({
      userId: userA.id,
      deviceId: "auth-test-device-1",
      deviceName: "Device 1",
      maxActiveSessions: 2,
    });

    // Two simultaneous requests compete for the final available slot. Advisory
    // locking must serialize them so exactly one wins and total active <= 2.
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

    // Same-device retry rotates that device's session rather than adding a third.
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

    const token = jwt.sign(
      { id: userA.id, email: userA.email, role: "FAN", sid: device1.id },
      process.env.JWT_SECRET!,
      { expiresIn: "1d" }
    );
    assert.equal((await invokeAuth(token)).nextCalled, true, "Active token must reach protected API");

    await SessionService.revokeSession(userA.id, device1.id);
    const afterLogout = await invokeAuth(token);
    assert.equal(afterLogout.nextCalled, false, "Revoked token must not reach protected API");
    assert.equal(afterLogout.statusCode, 401, "Revoked token must return 401");

    // Explicit device removal is user-scoped and must not remove another user's
    // session even when its numeric id is known/pasted.
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

    // Suspension and deletion must invalidate access even while the server-side
    // session row still exists.
    const suspensionSession = await SessionService.createSession({
      userId: userA.id,
      deviceId: "auth-test-suspension-device",
      maxActiveSessions: 2,
    });
    const suspensionToken = jwt.sign(
      { id: userA.id, email: userA.email, role: "FAN", sid: suspensionSession.id },
      process.env.JWT_SECRET!,
      { expiresIn: "1d" }
    );

    await pool.query("UPDATE users SET status = 'SUSPENDED' WHERE id = $1", [userA.id]);
    const suspended = await invokeAuth(suspensionToken);
    assert.equal(suspended.statusCode, 403, "Suspended account must fail closed");
    assert.equal(suspended.nextCalled, false);

    await pool.query("UPDATE users SET status = 'ACTIVE', is_deleted = true WHERE id = $1", [userA.id]);
    const deleted = await invokeAuth(suspensionToken);
    assert.equal(deleted.statusCode, 403, "Deleted account must fail closed");
    assert.equal(deleted.nextCalled, false);

    // Removing one device must not unexpectedly revoke another allowed device.
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
