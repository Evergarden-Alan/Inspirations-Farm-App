export const AI_COMMIT_PREFIX = "[ai-chat] ";

/** 工具层写权拒绝：note 仓库只许追加、review 只许 .md、路径越界等。 */
export class WriteForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WriteForbiddenError";
  }
}

/** 目标日记不存在（AI 不代建日记）。 */
export class JournalMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalMissingError";
  }
}
