import { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import {
  denyFocusPlaylistRequest,
  focusPlaylistErrorResponse,
  noStoreJson,
  readLimitedJsonBody,
  RequestBodyError,
} from "@/lib/focus-playlist-api";
import {
  addFocusPlaylist,
  deleteFocusPlaylist,
  listFocusPlaylists,
} from "@/lib/focus-playlist-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!validatePin(request)) return denyFocusPlaylistRequest();
  try {
    const config = await listFocusPlaylists();
    return noStoreJson({ ok: true, ...config });
  } catch (error) {
    return focusPlaylistErrorResponse(error, "FOCUS_PLAYLIST_GET");
  }
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!validatePin(request)) return denyFocusPlaylistRequest();
  try {
    const body = asRecord(await readLimitedJsonBody(request));
    if (
      !body
      || Object.keys(body).length !== 1
      || typeof body.url !== "string"
      || body.url.trim().length === 0
      || body.url.length > 2_048
    ) {
      throw new RequestBodyError("A playlist URL is required");
    }
    const result = await addFocusPlaylist(body.url);
    return noStoreJson({
      ok: true,
      created: result.created,
      updated: result.updated,
      reason: result.reason,
      playlist: result.playlist,
      items: result.items,
    }, { status: result.created ? 201 : 200 });
  } catch (error) {
    return focusPlaylistErrorResponse(error, "FOCUS_PLAYLIST_POST");
  }
}

export async function DELETE(request: NextRequest): Promise<Response> {
  if (!validatePin(request)) return denyFocusPlaylistRequest();
  try {
    const body = asRecord(await readLimitedJsonBody(request));
    if (
      !body
      || Object.keys(body).length !== 1
      || typeof body.id !== "string"
      || !/^bilibili:ugc-season:[1-9][0-9]{0,19}$/.test(body.id)
    ) {
      throw new RequestBodyError("A valid playlist ID is required");
    }
    const result = await deleteFocusPlaylist(body.id);
    return noStoreJson({ ok: true, playlist: result.playlist });
  } catch (error) {
    return focusPlaylistErrorResponse(error, "FOCUS_PLAYLIST_DELETE");
  }
}
