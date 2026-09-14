import type { PoolClient } from "pg";
import type { Phase1ReleaseMetadata } from "./release-domain.validation";

export type ReleaseCompatibilityResult = {
  releaseId: number;
  releaseTrackId: number;
  created: boolean;
};

/**
 * Create the future-facing Release -> ReleaseTrack aggregate for one canonical
 * Phase-1 AUDIO content row without changing the public content/playback ID.
 *
 * This function performs database mapping only. It never calls a distributor,
 * allocates UPC/ISRC values, or changes distribution state away from NOT_SUBMITTED.
 */
export async function ensureSingleReleaseForAudioContent(
  client: PoolClient,
  input: {
    contentId: number;
    artistId: number;
    title: string;
    genre: string | null;
    thumbnailStorageKey: string | null;
    thumbnailProviderAssetId: string | null;
    metadata: Phase1ReleaseMetadata;
  }
): Promise<ReleaseCompatibilityResult> {
  const existing = await client.query<{ id: string; release_id: string }>(
    `SELECT id, release_id
       FROM release_tracks
      WHERE content_item_id = $1
      LIMIT 1`,
    [input.contentId]
  );
  if (existing.rows[0]) {
    await client.query(
      `UPDATE content_items
          SET release_track_id = $2
        WHERE id = $1
          AND release_track_id IS DISTINCT FROM $2`,
      [input.contentId, Number(existing.rows[0].id)]
    );
    return {
      releaseId: Number(existing.rows[0].release_id),
      releaseTrackId: Number(existing.rows[0].id),
      created: false,
    };
  }

  const release = await client.query<{ id: string }>(
    `INSERT INTO releases (
       artist_id, title, release_type, primary_genre, language, explicit,
       label_name, early_access_start_at, public_release_at, exclusivity_end_at,
       release_phase, distribution_status, upc_ean,
       artwork_storage_key, artwork_provider_asset_id, source_content_id,
       created_at, updated_at
     ) VALUES (
       $1, $2, 'SINGLE', $3, $4, $5,
       $6, $7, $8, $9,
       'DRAFT', 'NOT_SUBMITTED', $10,
       $11, $12, $13,
       now(), now()
     )
     ON CONFLICT (source_content_id)
     DO UPDATE SET source_content_id = EXCLUDED.source_content_id
     RETURNING id`,
    [
      input.artistId,
      input.title,
      input.genre,
      input.metadata.language,
      input.metadata.explicit,
      input.metadata.labelName,
      input.metadata.earlyAccessStartAt,
      input.metadata.publicReleaseAt,
      input.metadata.exclusivityEndAt,
      input.metadata.upcEan,
      input.thumbnailStorageKey,
      input.thumbnailProviderAssetId,
      input.contentId,
    ]
  );
  const releaseId = Number(release.rows[0].id);

  const track = await client.query<{ id: string }>(
    `INSERT INTO release_tracks (
       release_id, content_item_id, artist_id, disc_number, track_number,
       title, explicit, isrc, created_at, updated_at
     ) VALUES ($1, $2, $3, 1, 1, $4, $5, $6, now(), now())
     ON CONFLICT (content_item_id)
     DO UPDATE SET content_item_id = EXCLUDED.content_item_id
     RETURNING id`,
    [
      releaseId,
      input.contentId,
      input.artistId,
      input.title,
      input.metadata.explicit,
      input.metadata.isrc,
    ]
  );
  const releaseTrackId = Number(track.rows[0].id);

  await client.query(
    `UPDATE content_items
        SET release_track_id = $2
      WHERE id = $1`,
    [input.contentId, releaseTrackId]
  );

  const primary = await client.query<{ display_name: string }>(
    `SELECT COALESCE(NULLIF(name, ''), split_part(email, '@', 1)) AS display_name
       FROM users
      WHERE id = $1
      LIMIT 1`,
    [input.artistId]
  );
  const primaryDisplayName = String(primary.rows[0]?.display_name || "Artist");

  await client.query(
    `INSERT INTO release_contributors (
       release_id, release_track_id, contributor_user_id, display_name, role, display_order
     ) VALUES ($1, $2, $3, $4, 'PRIMARY_ARTIST', 0)
     ON CONFLICT DO NOTHING`,
    [releaseId, releaseTrackId, input.artistId, primaryDisplayName]
  );

  let displayOrder = 1;
  for (const contributor of input.metadata.contributors) {
    await client.query(
      `INSERT INTO release_contributors (
         release_id, release_track_id, contributor_user_id, display_name, role, display_order
       ) VALUES ($1, $2, NULL, $3, $4, $5)`,
      [releaseId, releaseTrackId, contributor.displayName, contributor.role, displayOrder]
    );
    displayOrder += 1;
  }

  return { releaseId, releaseTrackId, created: true };
}
