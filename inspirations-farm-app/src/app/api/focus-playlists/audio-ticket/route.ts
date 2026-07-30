import { NextRequest } from "next/server";

import { validatePin } from "@/lib/auth";
import {
  denyFocusPlaylistRequest,
  focusPlaylistErrorResponse,
  noStoreJson,
  readLimitedJsonBody,
  RequestBodyError,
} from "@/lib/focus-playlist-api";
import { createFocusAudioTicket } from "@/lib/focus-playlist-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function POST(request: NextRequest): Promise<Response> {
  if (!validatePin(request)) return denyFocusPlaylistRequest();
  try {
    const body = asRecord(await readLimitedJsonBody(request));
    if (
      !body
      || Object.keys(body).some((key) => !["playlistId", "bvid", "cid"].includes(key))
      || typeof body.playlistId !== "string"
      || !/^bilibili:ugc-season:[1-9][0-9]{0,19}$/.test(body.playlistId)
      || typeof body.bvid !== "string"
      || !(body.cid === null || body.cid === undefined || typeof body.cid === "string")
    ) {
      throw new RequestBodyError("A valid playlist track is required");
    }
    const result = await createFocusAudioTicket({
      playlistId: body.playlistId,
      bvid: body.bvid,
      cid: typeof body.cid === "string" ? body.cid : null,
    });
    return noStoreJson({ ok: true, ...result });
  } catch (error) {
    return focusPlaylistErrorResponse(error, "FOCUS_AUDIO_TICKET");
  }
}
