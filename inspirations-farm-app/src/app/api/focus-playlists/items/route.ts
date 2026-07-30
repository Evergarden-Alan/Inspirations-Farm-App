import { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import {
  denyFocusPlaylistRequest,
  focusPlaylistErrorResponse,
  noStoreJson,
  RequestBodyError,
} from "@/lib/focus-playlist-api";
import { getFocusPlaylistItems } from "@/lib/focus-playlist-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<Response> {
  if (!validatePin(request)) return denyFocusPlaylistRequest();
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id || !/^bilibili:ugc-season:[1-9][0-9]{0,19}$/.test(id)) {
      throw new RequestBodyError("A valid playlist ID is required");
    }
    const resolution = await getFocusPlaylistItems(id);
    return noStoreJson({
      ok: true,
      playlist: resolution.playlist,
      fetchedAt: new Date().toISOString(),
      total: resolution.items.length,
      items: resolution.items,
    });
  } catch (error) {
    return focusPlaylistErrorResponse(error, "FOCUS_PLAYLIST_ITEMS");
  }
}
