import { Router } from "express";

import { requireAuth } from "../common/auth/requireAuth";
import { requireRoles } from "../common/auth/requireRoles";
import { prisma } from "../common/db/prisma";

const router = Router();
const requireFan = requireRoles("FAN");
const prismaAny = prisma as any;

router.use(requireAuth, requireFan);

router.post("/history", async (req: any, res) => {
  try {
    const userIdRaw = req.user?.id;
    const userId = Number(userIdRaw);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const rawQuery = (req.body?.query ?? "").toString();
    const query = rawQuery.trim();

    if (!query) {
      return res.status(400).json({ success: false, message: "Query is required" });
    }

    const existing = await prismaAny.search_history.findFirst({
      where: {
        user_id: userId,
        query: { equals: query, mode: "insensitive" },
      },
    });

    const item = existing
      ? await prismaAny.search_history.update({
          where: { id: existing.id },
          data: { created_at: new Date() },
        })
      : await prismaAny.search_history.create({
          data: { user_id: userId, query },
        });

    return res.json({ success: true, item });
  } catch (err) {
    console.error("[search] POST /history error", err);
    return res.status(500).json({ success: false, message: "Failed to save history" });
  }
});

router.get("/history", async (req: any, res) => {
  try {
    const userIdRaw = req.user?.id;
    const userId = Number(userIdRaw);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const items = await prismaAny.search_history.findMany({
      where: { user_id: userId },
      select: {
        id: true,
        query: true,
        created_at: true
      },
      orderBy: { created_at: "desc" },
      take: 10,
    });

    return res.json({ success: true, items });
  } catch (err) {
    console.error("[search] GET /history error", err);
    return res.status(500).json({ success: false, message: "Failed to fetch history" });
  }
});

router.delete("/history/:id", async (req: any, res) => {
  try {
    const userIdRaw = req.user?.id;
    const userId = Number(userIdRaw);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid id" });
    }

    const result = await prismaAny.search_history.deleteMany({
      where: {
        id,
        user_id: userId,
      },
    });

    if (!result.count) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("[search] DELETE /history/:id error", err);
    return res.status(500).json({ success: false, message: "Failed to delete history" });
  }
});

export default router;
