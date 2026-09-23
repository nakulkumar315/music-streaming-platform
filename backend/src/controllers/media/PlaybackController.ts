import { Request, Response } from 'express';
import { MediaProviderFactory } from '../../services/providers/MediaProviderFactory';
import { pool } from '../../common/db';

export const generatePlaybackUrl = async (req: Request | any, res: Response) => {
  const correlationId = req?.correlationId || "-";
  try {
    const mediaId = Number(req.params.id);

    if (isNaN(mediaId) || mediaId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid media ID' });
    }

    // 1. Validate Access Control and Backend Validation 
    // We only serve media if it's READY and PUBLISHED
    const dbResult = await pool.query(
      `SELECT id, type, provider_asset_id, technical_status, lifecycle_state 
       FROM content_items 
       WHERE id = $1`,
      [mediaId]
    );

    if (dbResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Media not found' });
    }

    const item = dbResult.rows[0];

    // Status Validations
    if (item.technical_status !== 'READY') {
      return res.status(400).json({ 
        success: false, 
        message: 'Media is currently processing or unavailable for playback.' 
      });
    }

    if (item.lifecycle_state !== 'PUBLISHED') {
      return res.status(403).json({ 
        success: false, 
        message: 'Media access denied (not published).' 
      });
    }

    if (!item.provider_asset_id) {
      return res.status(500).json({ 
        success: false, 
        message: 'Media provider asset missing.' 
      });
    }

    // Determine type for playback (Audio or Video)
    const mediaType = item.type.toLowerCase() === 'video' ? 'video' : 'audio';

    // 2. Obtain Signed Short-Lived URL directly via Provider Layer
    const provider = MediaProviderFactory.getProvider();
    
    const playbackMeta = await provider.generateSignedPlaybackUrl(
      item.provider_asset_id,
      mediaType,
      undefined,
      Number(process.env.MEDIA_URL_TTL_SECONDS || 300)
    );

    return res.json({
      success: true,
      playbackUrl: playbackMeta.playbackUrl,
      expiryTimeUnix: playbackMeta.expiryTime,
      mediaType: playbackMeta.mediaType,
      correlationId
    });

  } catch (error: any) {
    console.error("[PlaybackController] Error generating URL", correlationId, error);
    return res.status(500).json({ success: false, message: "Failed to generate playback URL" });
  }
};
