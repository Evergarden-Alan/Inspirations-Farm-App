import {
  createEmptyFocusPlaylistConfig,
  FocusPlaylistConfigError,
  parseFocusPlaylistConfig,
  removeFocusPlaylistConfig,
  serializeFocusPlaylistConfig,
  upsertFocusPlaylistConfig,
} from "./focus-playlist-config";
import {
  FOCUS_PLAYLIST_CONFIG_PATH,
  type FocusPlaylist,
  type FocusPlaylistConfig,
  type ResolvedFocusPlaylist,
} from "./focus-playlists";
import {
  decodeBase64,
  encodeBase64,
  getConfig,
  GitHubApiError,
  GitHubConflictError,
  githubFetch,
  withConflictRetry,
} from "./github-client";

interface FocusPlaylistFileSnapshot {
  config: FocusPlaylistConfig;
  sha: string | null;
}

export interface FocusPlaylistWriteResult {
  config: FocusPlaylistConfig;
  playlist: FocusPlaylist;
  created: boolean;
  updated: boolean;
  written: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

async function readSnapshot(now: string): Promise<FocusPlaylistFileSnapshot> {
  const { owner, repo } = getConfig();
  try {
    const data = await githubFetch<{ sha: string; content: string; encoding: string }>(
      `/repos/${owner}/${repo}/contents/${FOCUS_PLAYLIST_CONFIG_PATH}`
    );
    if (data.encoding !== "base64" || data.content.length > 4_194_304) {
      throw new FocusPlaylistConfigError(
        "CONFIG_CORRUPTED",
        "Focus playlist configuration has an invalid encoding or size"
      );
    }
    return {
      config: parseFocusPlaylistConfig(decodeBase64(data.content)),
      sha: data.sha,
    };
  } catch (error) {
    if (error instanceof GitHubApiError && error.status === 404) {
      return { config: createEmptyFocusPlaylistConfig(now), sha: null };
    }
    throw error;
  }
}

async function writeSnapshot(
  config: FocusPlaylistConfig,
  sha: string | null,
  message: string
): Promise<void> {
  const { owner, repo } = getConfig();
  await githubFetch(`/repos/${owner}/${repo}/contents/${FOCUS_PLAYLIST_CONFIG_PATH}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: encodeBase64(serializeFocusPlaylistConfig(config)),
      ...(sha ? { sha } : {}),
    }),
  });
}

function mapConflict(error: unknown): never {
  if (error instanceof GitHubConflictError) {
    throw new FocusPlaylistConfigError(
      "CONFIG_CONFLICT",
      "Focus playlist configuration changed concurrently",
      409
    );
  }
  throw error;
}

export async function readFocusPlaylistConfigFromGitHub(
  options: { now?: string } = {}
): Promise<FocusPlaylistConfig> {
  return (await readSnapshot(options.now ?? nowIso())).config;
}

export async function upsertFocusPlaylistOnGitHub(
  resolved: ResolvedFocusPlaylist,
  options: { now?: string } = {}
): Promise<FocusPlaylistWriteResult> {
  try {
    return await withConflictRetry(async () => {
      const now = options.now ?? nowIso();
      const snapshot = await readSnapshot(now);
      const result = upsertFocusPlaylistConfig(snapshot.config, resolved, now);
      const written = result.created || result.updated;
      if (written) {
        await writeSnapshot(
          result.config,
          snapshot.sha,
          result.created
            ? `Add focus playlist ${result.playlist.title}`
            : `Refresh focus playlist ${result.playlist.title}`
        );
      }
      return { ...result, written };
    });
  } catch (error) {
    return mapConflict(error);
  }
}

export async function removeFocusPlaylistFromGitHub(
  playlistId: string,
  options: { now?: string } = {}
): Promise<{ config: FocusPlaylistConfig; playlist: FocusPlaylist }> {
  try {
    return await withConflictRetry(async () => {
      const now = options.now ?? nowIso();
      const snapshot = await readSnapshot(now);
      const result = removeFocusPlaylistConfig(snapshot.config, playlistId, now);
      await writeSnapshot(
        result.config,
        snapshot.sha,
        `Remove focus playlist ${result.playlist.title}`
      );
      return result;
    });
  } catch (error) {
    return mapConflict(error);
  }
}
