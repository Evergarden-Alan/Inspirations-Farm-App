export const FOCUS_PLAYER_STORAGE_KEY = "farm_focus_player";
export const FOCUS_PLAYER_STATE_VERSION = 1 as const;
export const FOCUS_PLAYER_HISTORY_LIMIT = 20;

export interface FocusPlayerTrack {
  playlistId: string;
  bvid: string;
  cid: string;
  sourceIndex: number;
}

export interface FocusPlayerState extends FocusPlayerTrack {
  version: typeof FOCUS_PLAYER_STATE_VERSION;
  focusSessionId: string;
  currentTime: number;
  historyCursor: number;
  history: FocusPlayerTrack[];
  updatedAt: number;
}

interface FocusPlayerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const STATE_KEYS = [
  "version",
  "focusSessionId",
  "playlistId",
  "bvid",
  "cid",
  "sourceIndex",
  "currentTime",
  "historyCursor",
  "history",
  "updatedAt",
] as const;
const TRACK_KEYS = ["playlistId", "bvid", "cid", "sourceIndex"] as const;

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && expected.every((key, index) => key === actual[index]);
}

function parseTrack(value: unknown): FocusPlayerTrack | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, TRACK_KEYS)
    || typeof record.playlistId !== "string"
    || !/^bilibili:ugc-season:[1-9][0-9]{0,19}$/.test(record.playlistId)
    || typeof record.bvid !== "string"
    || !/^BV[0-9A-Za-z]{10}$/.test(record.bvid)
    || typeof record.cid !== "string"
    || !/^[1-9][0-9]{0,19}$/.test(record.cid)
    || typeof record.sourceIndex !== "number"
    || !Number.isSafeInteger(record.sourceIndex)
    || record.sourceIndex < 0
  ) {
    return null;
  }
  return record as unknown as FocusPlayerTrack;
}

function sameTrack(left: FocusPlayerTrack, right: FocusPlayerTrack): boolean {
  return left.playlistId === right.playlistId
    && left.bvid === right.bvid
    && left.cid === right.cid
    && left.sourceIndex === right.sourceIndex;
}

export function parseFocusPlayerState(value: unknown): FocusPlayerState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    !hasExactKeys(record, STATE_KEYS)
    || record.version !== FOCUS_PLAYER_STATE_VERSION
    || typeof record.focusSessionId !== "string"
    || record.focusSessionId.length === 0
    || record.focusSessionId.length > 200
    || typeof record.currentTime !== "number"
    || !Number.isFinite(record.currentTime)
    || record.currentTime < 0
    || record.currentTime > 604_800
    || typeof record.historyCursor !== "number"
    || !Number.isSafeInteger(record.historyCursor)
    || typeof record.updatedAt !== "number"
    || !Number.isSafeInteger(record.updatedAt)
    || record.updatedAt <= 0
    || !Array.isArray(record.history)
    || record.history.length === 0
    || record.history.length > FOCUS_PLAYER_HISTORY_LIMIT
    || record.historyCursor < 0
    || record.historyCursor >= record.history.length
  ) {
    return null;
  }
  const current = parseTrack({
    playlistId: record.playlistId,
    bvid: record.bvid,
    cid: record.cid,
    sourceIndex: record.sourceIndex,
  });
  const history = record.history.map(parseTrack);
  if (!current || history.some((track) => track === null)) return null;
  const typedHistory = history as FocusPlayerTrack[];
  if (!sameTrack(current, typedHistory[record.historyCursor])) return null;
  return {
    version: FOCUS_PLAYER_STATE_VERSION,
    focusSessionId: record.focusSessionId,
    ...current,
    currentTime: record.currentTime,
    historyCursor: record.historyCursor,
    history: typedHistory,
    updatedAt: record.updatedAt,
  };
}

function stateAtCursor(
  state: FocusPlayerState,
  history: FocusPlayerTrack[],
  historyCursor: number,
  updatedAt: number
): FocusPlayerState {
  const track = history[historyCursor];
  const next = {
    version: FOCUS_PLAYER_STATE_VERSION,
    focusSessionId: state.focusSessionId,
    ...track,
    currentTime: 0,
    historyCursor,
    history,
    updatedAt,
  };
  const parsed = parseFocusPlayerState(next);
  if (!parsed) throw new TypeError("Cannot create an invalid focus player history");
  return parsed;
}

export function createFocusPlayerState(
  focusSessionId: string,
  track: FocusPlayerTrack,
  updatedAt = Date.now()
): FocusPlayerState {
  const state = {
    version: FOCUS_PLAYER_STATE_VERSION,
    focusSessionId,
    ...track,
    currentTime: 0,
    historyCursor: 0,
    history: [track],
    updatedAt,
  };
  const parsed = parseFocusPlayerState(state);
  if (!parsed) throw new TypeError("Cannot create an invalid focus player state");
  return parsed;
}

export function updateFocusPlayerTime(
  state: FocusPlayerState,
  currentTime: number,
  updatedAt = Date.now()
): FocusPlayerState {
  const next = { ...state, currentTime, updatedAt };
  const parsed = parseFocusPlayerState(next);
  if (!parsed) throw new TypeError("Cannot save an invalid focus playback time");
  return parsed;
}

export function previousFocusPlayerTrack(
  state: FocusPlayerState,
  updatedAt = Date.now()
): FocusPlayerState {
  if (state.historyCursor === 0) return state;
  return stateAtCursor(state, state.history, state.historyCursor - 1, updatedAt);
}

export function nextFocusPlayerHistoryTrack(
  state: FocusPlayerState,
  updatedAt = Date.now()
): FocusPlayerState | null {
  if (state.historyCursor >= state.history.length - 1) return null;
  return stateAtCursor(state, state.history, state.historyCursor + 1, updatedAt);
}

export function appendFocusPlayerTrack(
  state: FocusPlayerState,
  track: FocusPlayerTrack,
  updatedAt = Date.now()
): FocusPlayerState {
  const forwardHistory = state.history.slice(0, state.historyCursor + 1);
  let history = [...forwardHistory, track];
  if (history.length > FOCUS_PLAYER_HISTORY_LIMIT) {
    history = history.slice(history.length - FOCUS_PLAYER_HISTORY_LIMIT);
  }
  return stateAtCursor(state, history, history.length - 1, updatedAt);
}

function browserStorage(): FocusPlayerStorage | null {
  return typeof localStorage === "undefined" ? null : localStorage;
}

export function readStoredFocusPlayerState(
  focusSessionId: string,
  storage: FocusPlayerStorage | null = browserStorage()
): FocusPlayerState | null {
  if (!storage) return null;
  const raw = storage.getItem(FOCUS_PLAYER_STORAGE_KEY);
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    storage.removeItem(FOCUS_PLAYER_STORAGE_KEY);
    return null;
  }
  const state = parseFocusPlayerState(value);
  if (!state || state.focusSessionId !== focusSessionId) {
    storage.removeItem(FOCUS_PLAYER_STORAGE_KEY);
    return null;
  }
  return state;
}

export function writeStoredFocusPlayerState(
  state: FocusPlayerState,
  storage: FocusPlayerStorage | null = browserStorage()
): boolean {
  if (!storage) return false;
  const parsed = parseFocusPlayerState(state);
  if (!parsed) throw new TypeError("Cannot persist an invalid focus player state");
  storage.setItem(FOCUS_PLAYER_STORAGE_KEY, JSON.stringify(parsed));
  return true;
}

export function clearStoredFocusPlayerState(
  storage: FocusPlayerStorage | null = browserStorage()
): void {
  storage?.removeItem(FOCUS_PLAYER_STORAGE_KEY);
}
