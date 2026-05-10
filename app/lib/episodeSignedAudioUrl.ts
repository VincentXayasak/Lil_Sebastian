import { PODCASTS_BUCKET, supabase } from './supabase';

/**
 * Private buckets need a time-limited signed URL; public URLs return HTTP 400 for non-public objects.
 */
export async function createEpisodePlaybackUrl(storagePath: string): Promise<string> {
  const path = storagePath.replace(/^\/+/, '');
  const { data, error } = await supabase.storage
    .from(PODCASTS_BUCKET)
    .createSignedUrl(path, 60 * 60 * 2); // 2 hours

  if (error || !data?.signedUrl) {
    throw new Error(
      error?.message ??
        'Could not create signed URL. Add a Storage SELECT policy for this bucket (see supabase_sql/storage_podcasts_private_read.sql).'
    );
  }
  return data.signedUrl;
}
