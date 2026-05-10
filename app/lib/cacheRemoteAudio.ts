import * as FileSystem from 'expo-file-system/legacy';

/** Last cache path per logical episode — delete when replacing so disk doesn’t fill. */
const lastCachePathByStableId = new Map<string, string>();

function extensionFromRemoteUrl(remoteUrl: string): string {
  try {
    const { pathname } = new URL(remoteUrl);
    const base = pathname.split('/').filter(Boolean).pop() ?? '';
    const dot = base.lastIndexOf('.');
    if (dot <= 0) return '.mp3';
    const ext = base.slice(dot);
    return /^\.[a-zA-Z0-9]+$/.test(ext) ? ext : '.mp3';
  } catch {
    return '.mp3';
  }
}

/**
 * iOS AVPlayer often fails streaming some HTTPS URLs; play a local file instead.
 * Uses a new cache file each time — reusing one path + delete-then-download breaks replay after Stop
 * (-11828 / "format not supported" from a truncated or locked file).
 */
export async function cacheRemoteAudioForPlayback(
  remoteUrl: string,
  stableId: string
): Promise<string> {
  const ext = extensionFromRemoteUrl(remoteUrl);
  const baseDir = FileSystem.cacheDirectory;
  if (!baseDir) {
    throw new Error('App cache folder is unavailable (try a device reset or reinstall).');
  }
  const safeId = stableId.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 72);
  const dest = `${baseDir}lil-seb-${safeId}-${Date.now()}${ext}`;

  const res = await FileSystem.downloadAsync(remoteUrl, dest);
  if (res.status !== 200) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
    throw new Error(
      `Download failed (HTTP ${res.status}). Is the bucket public and the file path correct?`
    );
  }

  const prev = lastCachePathByStableId.get(stableId);
  if (prev && prev !== res.uri) {
    void FileSystem.deleteAsync(prev, { idempotent: true });
  }
  lastCachePathByStableId.set(stableId, res.uri);

  return res.uri;
}
