import { Response } from "express";
import { pool } from "../../common/db";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { AuditService } from "../../shared/audit/audit.service";
import { getStorageService } from "../../shared/storage/services/storage.service";
import { getStorageConfig } from "../../config/storage.config";
import { getStorageProviderByName } from "../../shared/storage/factory/storage-provider.factory";
import { getExtensionFromMime } from "../../shared/storage/utils/file-metadata.util";
import type { StorageProviderName } from "../../shared/storage/interfaces/storage-types.interface";

const expo = new Expo();

export class UserController {
  async profile(req: any, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res.status(401).json({
          success: false,
          message: "Unauthorized",
        });
      }

      const q =
        "SELECT id, name, email, profile_image_url, bio, genre, username, location, status FROM users WHERE id = $1";
      const r = await pool.query(q, [userId]);
      const userRow = r.rows?.[0];

      if (!userRow) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }

      let subscriptionCount = 0;
      try {
        const subs = await pool.query(
          `SELECT COUNT(*)::int as c
           FROM subscriptions
           WHERE user_id = $1
             AND UPPER(COALESCE(status, '')) = 'ACTIVE'
             AND (next_billing_date IS NULL OR next_billing_date > now())`,
          [userId]
        );
        subscriptionCount = Number(subs.rows?.[0]?.c ?? 0);
      } catch {
        subscriptionCount = 0;
      }

      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      let profileImageUrl = userRow.profile_image_url ?? null;
      if (profileImageUrl && profileImageUrl.startsWith("/")) {
        profileImageUrl = `${baseUrl}${profileImageUrl}`;
      }

      return res.json({
        success: true,
        profile: {
          id: userRow.id,
          name: userRow.name ?? null,
          fullName: userRow.name ?? null,
          username: userRow.username ?? null,
          email: userRow.email,
          bio: userRow.bio ?? null,
          favoriteGenre: userRow.genre ?? null,
          location: userRow.location ?? null,
          profileImageUrl,
          audioQualityPref: "HIGH",
          notificationsPref: true,
          totalListenTimeSeconds: 0,
        },
        premium: {
          isPremium: subscriptionCount > 0,
          subscriptionCount,
        },
      });
    } catch {
      return res.status(500).json({
        success: false,
        message: "Server error",
      });
    }
  }

  async transactions(req: any, res: Response) {
    const userId = req.user?.id;
    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    try {
      const rows = await pool.query(
        `SELECT id, amount, currency, status, created_at as date, artist_name, razorpay_order_id, razorpay_payment_id
         FROM transactions
         WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 50`,
        [userId]
      );
      if (rows.rows) {
        const transactions = (rows.rows ?? []).map((r: any) => ({
          id: r.id,
          amount: Number(r.amount),
          currency: r.currency,
          status: r.status,
          date: r.date,
          artist_name: r.artist_name,
          razorpay_order_id: r.razorpay_order_id,
          razorpay_payment_id: r.razorpay_payment_id,
        }));
        return res.json({ success: true, transactions });
      } else {
        return res.json({ success: true, transactions: [] });
      }
    } catch (err: any) {
      console.error({ err, userId }, "[USER] Failed to fetch transactions");
      return res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
    }
  }

  async downloadInvoice(req: any, res: Response) {
    const userId = req.user?.id;
    const txId = req.params.id;

    if (!userId)
      return res.status(401).json({ success: false, message: "Unauthorized" });

    try {
      // 1. Fetch transaction and validate ownership
      const txRows = await pool.query(
        `SELECT t.*, u.full_name, u.email
         FROM transactions t
         JOIN users u ON t.user_id = u.id
         WHERE t.id = $1 AND t.user_id = $2`,
        [txId, userId]
      );

      if (txRows.rowCount === 0) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Transaction not found or access denied",
          });
      }

      const tx = txRows.rows[0];
      const { InvoiceService } = require("../../services/invoiceService");

      // 2. Map data for PDF
      const pdfBuffer = await InvoiceService.generateInvoicePDF({
        invoiceNumber: (
          tx.razorpay_payment_id ||
          tx.razorpay_order_id ||
          tx.id
        ).toString(),
        date: new Date(tx.payment_confirmed_at || tx.date).toLocaleDateString(),
        userName: tx.full_name || "User",
        userEmail: tx.email,
        planName: tx.artist_name
          ? `Artist Subscription: ${tx.artist_name}`
          : "Platform Plan",
        amount: Number(tx.amount),
        currency: tx.currency || "INR",
        billingCycle: tx.billing_cycle || "monthly",
      });

      // 3. Set headers and send
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=invoice_${txId}.pdf`
      );
      return res.send(pdfBuffer);
    } catch (err: any) {
      console.error({ err, userId, txId }, "[USER] Failed to generate invoice");
      return res
        .status(500)
        .json({ success: false, message: "Failed to generate invoice PDF" });
    }
  }

  async update(req: any, res: Response) {
    try {
      const userId = req.user?.id;

      if (!userId) {
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });
      }

      const { fullName, username, bio, favoriteGenre, location } = req.body;

      // Uniqueness check for username
      if (username && typeof username === "string" && username.trim().length > 0) {
        const usernameCheck = await pool.query(
          "SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2",
          [username.trim(), userId]
        );
        if (usernameCheck.rows.length > 0) {
          return res
            .status(400)
            .json({ success: false, message: "Username is already taken" });
        }
      }

      const resolvedName = fullName !== undefined ? fullName : req.body?.name;
      const updateQuery = `
        UPDATE users 
        SET 
          name = COALESCE($1, name),
          bio = COALESCE($2, bio),
          genre = COALESCE($3, genre),
          location = COALESCE($4, location),
          username = COALESCE($5, username),
          updated_at = now()
        WHERE id = $6
        RETURNING id, name, name as "fullName", username, bio, genre as "favoriteGenre", location, profile_image_url as "profileImageUrl"
      `;

      const result = await pool.query(updateQuery, [
        resolvedName !== undefined ? (resolvedName ? String(resolvedName).trim() : null) : null,
        bio !== undefined ? (bio ? String(bio).trim() : null) : null,
        favoriteGenre !== undefined ? (favoriteGenre ? String(favoriteGenre).trim() : null) : null,
        location !== undefined ? (location ? String(location).trim() : null) : null,
        username !== undefined ? (username ? String(username).trim() : null) : null,
        userId,
      ]);

      const updatedProfile = result.rows[0] || {};
      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      if (updatedProfile.profileImageUrl && updatedProfile.profileImageUrl.startsWith("/")) {
        updatedProfile.profileImageUrl = `${baseUrl}${updatedProfile.profileImageUrl}`;
      }

      AuditService.log({
        action: "user.profile_updated",
        entity: "user",
        entityId: String(userId),
        performedBy: userId,
        role: "fan",
        status: "success",
        metadata: { fullName: resolvedName, username },
      });

      return res.json({
        success: true,
        message: "Profile updated successfully",
        profile: updatedProfile,
      });
    } catch (error: any) {
      console.error("[UserController.update] error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }

  async updatePassword(req: any, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const { oldPassword, newPassword } = req.body;
      if (!oldPassword || !newPassword) {
        return res
          .status(400)
          .json({
            success: false,
            message: "Both old and new passwords are required",
          });
      }

      const userRes = await pool.query(
        "SELECT password FROM users WHERE id = $1",
        [userId]
      );
      if (userRes.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }

      const user = userRes.rows[0];
      const bcrypt = require("bcrypt");

      const isValid = await bcrypt.compare(oldPassword, user.password);
      if (!isValid) {
        return res
          .status(400)
          .json({ success: false, message: "Incorrect old password" });
      }

      const hashed = await bcrypt.hash(newPassword, 10);
      await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
        hashed,
        userId,
      ]);

      return res.json({
        success: true,
        message: "Password updated successfully",
      });
    } catch (error: any) {
      console.error("[UserController.updatePassword] error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }

  async updateProfileImage(req: any, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      let fileBuffer: Buffer | null = null;
      let fileMime: string = "image/jpeg";
      let fileSize: number = 0;

      if (req.file) {
        fileBuffer = req.file.buffer;
        fileMime = req.file.mimetype || "image/jpeg";
        fileSize = req.file.size;
      } else if (req.body?.image && typeof req.body.image === "string") {
        const rawImage = req.body.image.trim();
        if (rawImage.startsWith("data:")) {
          const matches = rawImage.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
          if (matches && matches.length === 3) {
            fileMime = matches[1];
            fileBuffer = Buffer.from(matches[2], "base64");
            fileSize = fileBuffer.length;
          }
        } else if (rawImage.length > 0 && rawImage !== "[object Object]") {
          fileBuffer = Buffer.from(rawImage, "base64");
          fileSize = fileBuffer.length;
        }
      }

      if (!fileBuffer || fileSize === 0) {
        return res
          .status(400)
          .json({ success: false, message: "No image file provided" });
      }

      const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
      if (fileSize > MAX_FILE_SIZE) {
        return res.status(400).json({
          success: false,
          message: `Please keep image under 2MB. Your file is ${(
            fileSize /
            (1024 * 1024)
          ).toFixed(2)}MB.`,
        });
      }

      const extension = getExtensionFromMime(fileMime) || "jpg";
      const storageKey = `users/${userId}/profile/${Date.now()}.${extension}`;
      const storage = getStorageService();
      const config = getStorageConfig();

      const uploadResult = await storage.upload({
        storageKey,
        body: fileBuffer,
        contentType: fileMime,
        contentLength: fileSize,
        metadata: { userId: String(userId), assetKind: "PROFILE" },
      });

      await pool.query(
        `INSERT INTO user_media_assets (
           user_id, kind, storage_provider, storage_key, provider_asset_id,
           mime_type, size_bytes, created_at, updated_at
         ) VALUES ($1, 'PROFILE', $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (user_id, kind)
         DO UPDATE SET
           storage_provider = EXCLUDED.storage_provider,
           storage_key = EXCLUDED.storage_key,
           provider_asset_id = EXCLUDED.provider_asset_id,
           mime_type = EXCLUDED.mime_type,
           size_bytes = EXCLUDED.size_bytes,
           updated_at = now()`,
        [
          userId,
          config.provider,
          storageKey,
          uploadResult.providerAssetId || null,
          fileMime,
          fileSize,
        ]
      );

      const avatarPath = `/api/v1/fan/user/avatar/${userId}`;
      await pool.query(
        "UPDATE users SET profile_image_url = $1, updated_at = now() WHERE id = $2",
        [avatarPath, userId]
      );

      const baseUrl = process.env.APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const absoluteUrl = `${baseUrl}${avatarPath}`;

      return res.json({
        success: true,
        message: "Profile image updated",
        profileImageUrl: absoluteUrl,
      });
    } catch (error: any) {
      console.error("[UserController.updateProfileImage] error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }

  async getAvatar(req: any, res: Response) {
    try {
      const targetUserId = parseInt(req.params.id, 10);
      if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid user ID" });
      }

      const result = await pool.query(
        `SELECT storage_provider, storage_key, provider_asset_id, mime_type, size_bytes
         FROM user_media_assets
         WHERE user_id = $1 AND kind = 'PROFILE'
         LIMIT 1`,
        [targetUserId]
      );
      const asset = result.rows[0];

      if (!asset) {
        const userRes = await pool.query(
          "SELECT profile_image_url FROM users WHERE id = $1 LIMIT 1",
          [targetUserId]
        );
        const externalUrl = userRes.rows[0]?.profile_image_url;
        if (externalUrl && (externalUrl.startsWith("http://") || externalUrl.startsWith("https://"))) {
          res.setHeader("Cache-Control", "public, max-age=300");
          return res.redirect(302, externalUrl);
        }
        return res.status(404).json({ success: false, message: "Avatar not found" });
      }

      const storage = getStorageProviderByName(asset.storage_provider as StorageProviderName);
      if (asset.provider_asset_id && storage.getPublicObjectUrl) {
        const url = await storage.getPublicObjectUrl({
          providerAssetId: String(asset.provider_asset_id),
          mediaType: "thumbnail",
        });
        if (url) {
          res.setHeader("Cache-Control", "public, max-age=300");
          return res.redirect(302, url);
        }
      }

      if (!storage.openReadStream) {
        return res.status(404).json({ success: false, message: "Image delivery unavailable" });
      }

      const read = await storage.openReadStream({ storageKey: String(asset.storage_key) });
      res.setHeader("Content-Type", String(asset.mime_type || read.contentType || "image/jpeg"));
      const size = Number(asset.size_bytes || read.contentLength);
      if (Number.isFinite(size) && size > 0) res.setHeader("Content-Length", String(size));
      res.setHeader("Cache-Control", "public, max-age=300");
      read.stream.once("error", () => {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });
      return read.stream.pipe(res);
    } catch (error) {
      console.error("[UserController.getAvatar] error:", error);
      return res.status(500).json({ success: false, message: "Failed to load avatar" });
    }
  }
  async updateSettings(req: any, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const { pushNotifications, expoPushToken } = req.body;

      await pool.query(
        `UPDATE users SET 
          notifications_pref = COALESCE($1, notifications_pref),
          expo_push_token = COALESCE($2, expo_push_token)
         WHERE id = $3`,
        [
          pushNotifications !== undefined ? pushNotifications : null,
          expoPushToken || null,
          userId,
        ]
      );

      return res.json({ success: true, message: "Settings updated" });
    } catch (error: any) {
      console.error("[UserController.updateSettings] error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }

  async testPush(req: any, res: Response) {
    try {
      const userId = req.user?.id;
      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const userRes = await pool.query(
        "SELECT expo_push_token, notifications_pref FROM users WHERE id = $1",
        [userId]
      );

      const user = userRes.rows[0];
      const token = user?.expo_push_token;

      if (!token) {
        return res.status(400).json({
          success: false,
          message:
            "No push token found. Please enable push notifications in the app first.",
        });
      }

      if (!user.notifications_pref) {
        return res.status(400).json({
          success: false,
          message: "Push notifications are disabled for this user.",
        });
      }

      // Only bypass validation if it's a SIM_MOCK for testing
      if (
        !token.startsWith("ExponentPushToken[SIM_MOCK_") &&
        !Expo.isExpoPushToken(token)
      ) {
        return res
          .status(400)
          .json({ success: false, message: "Invalid Expo push token" });
      }

      if (token.startsWith("ExponentPushToken[SIM_MOCK_")) {
        console.log(`[Push] Bypassing real send for Mock Token: ${token}`);
        return res.json({
          success: true,
          message:
            "Test push notification 'sent' (bypassed because it's a simulator mock)!",
          mockToken: token,
        });
      }

      const messages: ExpoPushMessage[] = [
        {
          to: token,
          sound: "default",
          title: "🎵 Music Streaming Platform",
          body: "Hey! Your push notifications are working correctly!",
          data: { type: "test" },
        },
      ];

      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];

      for (const chunk of chunks) {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      }

      return res.json({
        success: true,
        message: "Test push notification sent!",
        tickets,
      });
    } catch (error: any) {
      console.error("[UserController.testPush] error:", error);
      return res
        .status(500)
        .json({ success: false, message: "Server error: " + error.message });
    }
  }

  async invoice(req: any, res: Response) {
    try {
      const userId = req.user?.id;
      const txId = req.params.id;

      if (!userId)
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const txRes = await pool.query(
        `SELECT t.id, t.amount, t.currency, t.artist_name, t.status, t.created_at as date, t.billing_cycle, u.name as customer_name, u.email as customer_email
         FROM transactions t
         JOIN users u ON u.id = t.user_id
         WHERE t.id = $1 AND t.user_id = $2`,
        [txId, userId]
      );

      const tx = txRes.rows[0];
      if (!tx)
        return res
          .status(404)
          .json({ success: false, message: "Transaction not found" });

      const {
        InvoiceService,
      } = require("../../shared/financials/invoice.service");
      const pdfBuffer = await InvoiceService.generateInvoiceBuffer({
        invoiceNumber: `INV-${tx.id}`,
        date: new Date(tx.date).toLocaleDateString(),
        customerName: tx.customer_name || "Valued Customer",
        customerEmail: tx.customer_email,
        artistName: tx.artist_name,
        amount: Number(tx.amount) / 100, // Convert paise to INR
        currency: tx.currency || "INR",
        status: tx.status,
        billingCycle: tx.billing_cycle || "monthly",
      });

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=invoice-${txId}.pdf`
      );
      return res.send(pdfBuffer);
    } catch (error: any) {
      console.error("[UserController.invoice] error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }

  async getListenTime(req: any, res: Response) {
    try {
      const userId = Number(req.user?.id);
      if (!userId || isNaN(userId))
        return res
          .status(401)
          .json({ success: false, message: "Unauthorized" });

      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth() + 1;

      // ── Source 1: Heartbeat-based stats (most accurate) ──────────────
      // Query ALL months, not just current, so historical data appears too
      const statsResult = await pool.query(
        `SELECT COALESCE(SUM(total_seconds), 0)::bigint AS total_seconds
         FROM user_listening_stats
         WHERE user_id = $1`,
        [userId]
      );
      let totalSeconds = Number(statsResult.rows[0]?.total_seconds || 0);

      // ── Source 2: playback_sessions fallback (when heartbeats have no data) ──
      // Each session = duration from started_at to heartbeat_at (or 3 min avg if no heartbeat)
      if (totalSeconds === 0) {
        const sessionsResult = await pool
          .query(
            `SELECT 
            COUNT(*) AS session_count,
            COALESCE(
              SUM(
                LEAST(600, EXTRACT(EPOCH FROM (
                  COALESCE(heartbeat_at, started_at + INTERVAL '3 minutes') - started_at
                )))
              ), 0
            )::bigint AS estimated_seconds
           FROM playback_sessions
           WHERE user_id = $1`,
            [userId]
          )
          .catch((err) => {
            console.error(
              "[UserController.getListenTime] sessionsResult query failed:",
              err
            );
            return { rows: [{ session_count: 0, estimated_seconds: 0 }] };
          });

        const estimated = Number(
          sessionsResult.rows[0]?.estimated_seconds || 0
        );
        const sessionCount = Number(sessionsResult.rows[0]?.session_count || 0);

        if (estimated > 0) {
          totalSeconds = estimated;
        } else if (sessionCount > 0) {
          // Last resort: assume average 3 min per song play
          totalSeconds = sessionCount * 180;
        }
      }

      // ── Source 3: content_plays count as last resort ─────────────────
      if (totalSeconds === 0) {
        const playsResult = await pool
          .query(
            `SELECT COUNT(*) AS play_count FROM content_plays WHERE user_id = $1`,
            [userId]
          )
          .catch(() => ({ rows: [{ play_count: 0 }] }));
        const playCount = Number(playsResult.rows[0]?.play_count || 0);
        if (playCount > 0) {
          totalSeconds = playCount * 180; // assume ~3 min per play
        }
      }

      const totalMinutes = Math.floor(totalSeconds / 60);

      // Format: e.g., "2h 34m" or "45m"
      let formattedTime = "0m";
      if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        formattedTime = mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
      } else if (totalMinutes > 0) {
        formattedTime = `${totalMinutes}m`;
      }

      return res.json({
        success: true,
        totalMinutes,
        formattedTime,
        source: totalSeconds === 0 ? "none" : "computed",
      });
    } catch (error: any) {
      console.error("[UserController.getListenTime] error:", error);
      return res.status(500).json({ success: false, message: "Server error" });
    }
  }
}
