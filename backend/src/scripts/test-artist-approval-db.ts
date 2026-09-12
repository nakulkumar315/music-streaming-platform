import assert from "node:assert/strict";
import jwt from "jsonwebtoken";

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to run artist-approval DB tests with NODE_ENV=production");
  }

  const testDatabaseUrl = String(process.env.AUTH_TEST_DATABASE_URL || "").trim();
  if (!testDatabaseUrl) {
    throw new Error(
      "AUTH_TEST_DATABASE_URL is required. Use a disposable migrated test database; never point this script at production."
    );
  }

  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.JWT_SECRET =
    process.env.JWT_SECRET || "artist-approval-test-secret-not-for-real-environments";

  const [
    { pool },
    { SessionService },
    { requireAuth, requireVerifiedArtist },
    { ArtistApprovalService },
  ] = await Promise.all([
    import("../common/db"),
    import("../common/auth/session.service"),
    import("../common/auth/requireAuth"),
    import("../modules/artist/artist-approval.service"),
  ]);

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userIds: number[] = [];

  const createArtist = async (label: string, status = "ACTIVE", isDeleted = false) => {
    const email = `artist-approval-${label}-${suffix}@example.invalid`;
    const result = await pool.query(
      `INSERT INTO users (
         email, password, role, status, is_deleted, name, artist_status, is_verified, verified
       )
       VALUES ($1, 'approval-test-hash', 'ARTIST', $2, $3, 'Approval Test Artist', 'PENDING', false, false)
       RETURNING id, email`,
      [email, status, isDeleted]
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

  const resolveRequest = async (token: string) => {
    const req: any = { headers: { authorization: `Bearer ${token}` } };
    let authStatus = 200;
    let authNext = false;
    const authRes: any = {
      status(code: number) {
        authStatus = code;
        return this;
      },
      json() {
        return this;
      },
    };

    await requireAuth(req, authRes, () => {
      authNext = true;
    });

    let verifiedStatus = 200;
    let verifiedNext = false;
    if (authNext) {
      const verifiedRes: any = {
        status(code: number) {
          verifiedStatus = code;
          return this;
        },
        json() {
          return this;
        },
      };
      requireVerifiedArtist(req, verifiedRes, () => {
        verifiedNext = true;
      });
    }

    return { req, authStatus, authNext, verifiedStatus, verifiedNext };
  };

  try {
    const artist = await createArtist("lifecycle");
    const session = await SessionService.createSession({
      userId: artist.id,
      deviceId: "artist-approval-device",
      maxActiveSessions: 2,
    });
    const token = tokenFor(artist, session.id);

    const pending = await resolveRequest(token);
    assert.equal(pending.authNext, true, "Pending artist keeps authenticated account access");
    assert.equal(pending.verifiedNext, false, "Pending artist must not reach verified business surfaces");
    assert.equal(pending.verifiedStatus, 403);

    const approved = await ArtistApprovalService.resolve({
      artistId: artist.id,
      action: "APPROVE",
    });
    assert.equal(approved.status, "APPROVED");
    assert.equal(approved.isVerified, true);

    const approvedRow = await pool.query(
      "SELECT artist_status, is_verified, verified FROM users WHERE id = $1",
      [artist.id]
    );
    assert.equal(String(approvedRow.rows[0].artist_status).toUpperCase(), "APPROVED");
    assert.equal(approvedRow.rows[0].is_verified, true);
    assert.equal(approvedRow.rows[0].verified, true);

    const statsRow = await pool.query(
      "SELECT artist_id FROM artist_stats WHERE artist_id = $1",
      [artist.id]
    );
    assert.equal(statsRow.rows.length, 1, "Approval must ensure artist stats exist transactionally");

    const approvedAccess = await resolveRequest(token);
    assert.equal(approvedAccess.authNext, true);
    assert.equal(approvedAccess.verifiedNext, true, "Existing session may use approved business surfaces after DB approval");

    await assert.rejects(
      () =>
        ArtistApprovalService.resolve({
          artistId: artist.id,
          action: "REJECT",
          reason: "",
        }),
      (error: any) => error?.code === "REJECTION_REASON_REQUIRED"
    );

    const rejected = await ArtistApprovalService.resolve({
      artistId: artist.id,
      action: "REJECT",
      reason: "Missing required artist documentation",
    });
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.isVerified, false);

    const rejectedAccess = await resolveRequest(token);
    assert.equal(
      rejectedAccess.authNext,
      true,
      "Rejected artist must retain authenticated account access for appeal/onboarding recovery"
    );
    assert.equal(
      rejectedAccess.verifiedNext,
      false,
      "Rejected artist must lose verified business access immediately without waiting for token expiry"
    );
    assert.equal(rejectedAccess.verifiedStatus, 403);

    const rejectedRow = await pool.query(
      "SELECT artist_status, is_verified, verified, admin_remarks FROM users WHERE id = $1",
      [artist.id]
    );
    assert.equal(String(rejectedRow.rows[0].artist_status).toUpperCase(), "REJECTED");
    assert.equal(rejectedRow.rows[0].is_verified, false);
    assert.equal(rejectedRow.rows[0].verified, false);
    assert.equal(rejectedRow.rows[0].admin_remarks, "Missing required artist documentation");

    const inactiveArtist = await createArtist("inactive", "SUSPENDED", false);
    await assert.rejects(
      () =>
        ArtistApprovalService.resolve({
          artistId: inactiveArtist.id,
          action: "APPROVE",
        }),
      (error: any) => error?.code === "ARTIST_ACCOUNT_INACTIVE"
    );

    const deletedArtist = await createArtist("deleted", "ACTIVE", true);
    await assert.rejects(
      () =>
        ArtistApprovalService.resolve({
          artistId: deletedArtist.id,
          action: "APPROVE",
        }),
      (error: any) => error?.code === "ARTIST_ACCOUNT_INACTIVE"
    );

    console.log("Artist approval DB integration checks passed.");
  } finally {
    if (userIds.length > 0) {
      await pool.query("DELETE FROM artist_stats WHERE artist_id = ANY($1::int[])", [userIds]).catch(() => undefined);
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
