import type { Metadata } from "next";

import { FocusPlaylistSettings } from "./focus-playlist-settings";

export const metadata: Metadata = {
  title: "设置 · 灵感农场",
  description: "管理专注播放队列。",
};

export default function SettingsPage() {
  return <FocusPlaylistSettings />;
}
