import { NextFunction, Response } from "express";

export function requireRoles(...allowedRoles: string[]) {
  const allowed = new Set(allowedRoles.map((role) => role.toUpperCase()));

  return (req: any, res: Response, next: NextFunction) => {
    const role = String(req.user?.role || "").toUpperCase();

    if (!role || !allowed.has(role)) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Forbidden",
      });
    }

    return next();
  };
}
