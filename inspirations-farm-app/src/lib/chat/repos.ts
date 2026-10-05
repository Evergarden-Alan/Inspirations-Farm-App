export type ChatRepoId = "note" | "review";

export interface ChatRepo {
  id: ChatRepoId;
  owner: string;
  repo: string;
  label: string;
}

export class ChatConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatConfigError";
  }
}

/** The two remote repos the counselor chat reads/writes: the note vault
 *  (REPO_OWNER/REPO_NAME, already the app's database) and the review_status
 *  planning repo (REVIEW_REPO_OWNER/REVIEW_REPO_NAME). */
export function getChatRepos(
  env: Record<string, string | undefined> = process.env
): { note: ChatRepo; review: ChatRepo } {
  const { REPO_OWNER, REPO_NAME, REVIEW_REPO_OWNER, REVIEW_REPO_NAME } = env;
  if (!REPO_OWNER || !REPO_NAME) {
    throw new ChatConfigError("Missing REPO_OWNER/REPO_NAME (note vault)");
  }
  if (!REVIEW_REPO_OWNER || !REVIEW_REPO_NAME) {
    throw new ChatConfigError(
      "Missing REVIEW_REPO_OWNER/REVIEW_REPO_NAME (review_status)"
    );
  }
  return {
    note: { id: "note", owner: REPO_OWNER, repo: REPO_NAME, label: "日记/灵感库" },
    review: { id: "review", owner: REVIEW_REPO_OWNER, repo: REVIEW_REPO_NAME, label: "复习计划库" },
  };
}
