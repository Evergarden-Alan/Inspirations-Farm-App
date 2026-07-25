/**
 * Pure Markdown parsing & manipulation utilities.
 *
 * No network, no GitHub, no business logic — just functions that take strings
 * (or parsed structures) and return strings/structures. Used by github.ts
 * (the data service) and directly by client components.
 */

import matter from "gray-matter";
import * as yaml from "js-yaml";
import { fromMarkdown } from "mdast-util-from-markdown";
import { frontmatter } from "micromark-extension-frontmatter";
import { frontmatterFromMarkdown } from "mdast-util-frontmatter";

/**
 * gray-matter options that parse frontmatter with js-yaml's JSON_SCHEMA.
 * JSON_SCHEMA omits the `timestamp` type, so date-like values such as
 * `create: 2026-06-19 11:32:01` stay plain strings instead of being coerced
 * into Date objects (which would reinterpret Beijing time as UTC and corrupt
 * the field on round-trip). Use this for any matter() / matter.stringify()
 * round-trip that must preserve frontmatter verbatim.
 */
export const MATTER_OPTS = {
  engines: {
    yaml: {
      parse: (input: string) =>
        yaml.load(input, { schema: yaml.JSON_SCHEMA }) as object,
      stringify: (data: object) =>
        yaml.dump(data, { schema: yaml.JSON_SCHEMA, lineWidth: -1 }),
    },
  },
};

const LINK_RE = /\[\[(\d{4}-\d{2}-\d{2}-\d{6})(?:\|(.*?))?\]\]/;

// ── Types ──────────────────────────────────────────────

export interface ParsedMarkdown {
  frontmatter: Record<string, string | string[]>;
  body: string;
}

export interface InspirationPatch {
  time: string;   // "YYYY-MM-DD HH:mm" — full form after normalization
  content: string;
}

export interface DailyTask {
  id: number;
  parentId: number | null;
  text: string; // raw text after "- [ ] " for markdown reconstruction
  displayText: string; // text shown in the UI (alias or original)
  sourceIdeaId: string | null; // extracted from [[timestamp|alias]] or null
  done: boolean;
  indentLevel: number;
  indent: string;
  lineNumber: number;
}

export interface DailyNote {
  time: string; // HH:mm
  text: string;
}

// ── Frontmatter (date-safe) ────────────────────────────

/** Parse frontmatter with the date-safe MATTER_OPTS (date-like values stay
 *  strings, not Date objects). Returns the frontmatter data object only. */
export function parseFrontmatter(raw: string): Record<string, unknown> {
  return matter(raw, MATTER_OPTS).data;
}

/** Update a single frontmatter field and re-serialize, preserving the body and
 *  all other fields verbatim. JSON_SCHEMA keeps date-like values (e.g.
 *  `create: 2026-06-19 11:32:01`) as strings across the round-trip. */
export function setFrontmatterField(
  raw: string,
  field: string,
  value: unknown
): string {
  const parsed = matter(raw, MATTER_OPTS);
  parsed.data[field] = value;
  return matter.stringify(parsed.content, parsed.data, MATTER_OPTS);
}

// ── Markdown parsing ───────────────────────────────────

/** Parse YAML frontmatter and body from a markdown string */
export function parseMarkdown(text: string): ParsedMarkdown {
  const { data, content } = matter(text);
  return { frontmatter: data as Record<string, string | string[]>, body: content.trim() };
}

/** Extract the first # heading text from a markdown body */
export function extractTitle(body: string): string {
  const match = body.match(/^#\s+(.*)$/m);
  return match ? match[1].trim() : "";
}

/** Strip the first # heading line from the body */
export function stripHeading(body: string): string {
  return body.replace(/^#\s+.*\n?/m, "").trim();
}

// ── Patch (追加记录) parsing ────────────────────────────

/**
 * Split an inspiration body at ## 追加记录.
 * Returns the content above the section and parsed patches from below it.
 * For HH:mm-only timestamps, the createdAt date is prepended.
 */
export function parseInspirationPatches(
  body: string,
  createdAt: string
): { content: string; patches: InspirationPatch[] } {
  const lines = body.split("\n");
  const root = parseMarkdownAst(body);
  // Locate ## 追加记录 via mdast (code-block- and frontmatter-safe).
  const headingLine = findHeadingLine(root, "追加记录"); // 1-based, -1 if absent

  if (headingLine === -1) {
    return { content: body, patches: [] };
  }

  const headingLine0 = headingLine - 1; // 0-based

  // Content is everything above the heading
  const content = lines.slice(0, headingLine0).join("\n").trim();

  // Section ends at the next heading of any depth (NOT at `---`).
  const endLine = findSectionEndLine(
    root,
    headingLine,
    { headingEnds: () => true, thematicBreakEnds: false },
    lines.length + 1
  );
  const sectionEnd0 = endLine - 1; // 0-based; === lines.length when EOF

  // Parse patch lines: - **[YYYY-MM-DD HH:mm]** text  or  - **[HH:mm]** text.
  // A timestamp bullet starts a new patch; every line after it — until the next
  // timestamp bullet or a new heading (sectionEnd) — is a continuation line
  // appended to that patch's content. Previously only the first line was
  // captured and the rest of a multi-line patch was silently dropped.
  const createdDate = createdAt.slice(0, 10); // "YYYY-MM-DD"
  const patchRe = /^-\s+\*\*(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}|\d{2}:\d{2})\*\*\s+(.*)$/;

  // Accumulate raw lines per patch, then trim outer whitespace on finalisation
  // so trailing blank lines between patches don't leak into content while
  // internal blank lines and indentation are preserved.
  const rawPatches: { time: string; lines: string[] }[] = [];

  for (let i = headingLine0 + 1; i < sectionEnd0; i++) {
    const line = lines[i];
    const match = line.match(patchRe);
    if (match) {
      const rawTime = match[1];
      const fullTime =
        rawTime.length === 5 ? `${createdDate} ${rawTime}` : rawTime;
      rawPatches.push({ time: fullTime, lines: [match[2]] });
    } else if (rawPatches.length > 0) {
      // Continuation line — append to the most recent patch. Lines before the
      // first timestamp bullet are loose content and ignored (as before).
      rawPatches[rawPatches.length - 1].lines.push(line);
    }
  }

  const patches: InspirationPatch[] = rawPatches.map(({ time, lines }) => ({
    time,
    content: lines.join("\n").trim(),
  }));

  return { content, patches };
}

// ── Daily tasks ────────────────────────────────────────

function calcIndent(ws: string): { level: number; raw: string } {
  // Normalise tabs to 2 spaces so mixed whitespace (e.g. \t + spaces) is
  // handled correctly.  Then every 2 spaces = 1 indent level.
  const normalised = ws.replace(/\t/g, "  ");
  // Floor (not round) so a stray single space (0.5 of a level) doesn't count
  // as a full indent level — a 1-space indent isn't a real Markdown nesting
  // level. Tabs already normalise to 2 spaces, so whole-tab indents are
  // unaffected; only odd-space counts shift down by one level.
  return { level: Math.floor(normalised.length / 2), raw: ws };
}

export function parseTasks(markdown: string): DailyTask[] {
  const lines = markdown.split("\n");
  const tasks: DailyTask[] = [];
  let id = 0;

  // Build a set of line numbers that are inside fenced code blocks to skip them
  const codeLines = collectCodeLines(parseMarkdownAst(markdown));

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum];

    // Skip lines inside fenced code blocks - a `- [ ]` in a code example is NOT a real task
    if (codeLines.has(lineNum + 1)) continue;

    // [ ] | [x] | [>] — '>' marks partially-done rollover tasks (kept as undone).
    // Bullet prefix accepts -, *, or + (all valid Markdown task-list markers).
    const match = line.match(/^(\s*)[-+*]\s*\[([ xX>])\]\s+(.*)$/);
    if (match) {
      const { level, raw } = calcIndent(match[1]);
      const rawText = match[3].trim();

      // Parse [[timestamp|alias]] double-bracket link
      const linkMatch = rawText.match(LINK_RE);
      const sourceIdeaId = linkMatch ? linkMatch[1] : null;
      const displayText = linkMatch
        ? (linkMatch[2] || linkMatch[1])
        : rawText;

      tasks.push({
        id: id++,
        parentId: null,
        done: match[2].toLowerCase() === "x",
        text: rawText,
        displayText,
        sourceIdeaId,
        indentLevel: level,
        indent: raw,
        lineNumber: lineNum,
      });
    }
  }
  return computeParents(tasks);
}

/** Assign parentId to each task based on indentLevel */
export function computeParents(tasks: DailyTask[]): DailyTask[] {
  const stack: { id: number; level: number }[] = [];
  for (const task of tasks) {
    while (stack.length > 0 && stack[stack.length - 1].level >= task.indentLevel) {
      stack.pop();
    }
    task.parentId = stack.length > 0 ? stack[stack.length - 1].id : null;
    stack.push({ id: task.id, level: task.indentLevel });
  }
  return tasks;
}

// ── Daily Notes (今日杂记) ────────────────────────────

/** Extract notes from the ## 今日杂记 section. Heading and section boundary
 *  are located via mdast (code-block- and frontmatter-safe). */
export function parseDailyNotes(content: string): DailyNote[] {
  const lines = content.split("\n");
  const root = parseMarkdownAst(content);
  // Locate ## 今日杂记 via mdast (code-block- and frontmatter-safe).
  const sectionStart = findHeadingLine(root, "今日杂记"); // 1-based, -1 if absent
  if (sectionStart === -1) return [];

  const sectionStart0 = sectionStart - 1; // 0-based

  // Section ends at the next H1 heading or `---`.
  const endLine = findSectionEndLine(
    root,
    sectionStart,
    { headingEnds: (d) => d === 1, thematicBreakEnds: true },
    lines.length + 1
  );
  const sectionEnd0 = endLine - 1; // 0-based; === lines.length when EOF

  const notes: DailyNote[] = [];
  const noteRe = /^-\s+\*\*(\d{2}:\d{2})\*\*\s+(.*)$/;
  for (let i = sectionStart0 + 1; i < sectionEnd0; i++) {
    const match = lines[i].match(noteRe);
    if (match) {
      notes.push({ time: match[1], text: match[2].trim() });
    }
  }
  return notes;
}

// ── AST-based section location (mdast) ──────────────────
//
// The insertion helpers below parse the document to an mdast tree ONLY to
// locate headings and section boundaries robustly. Fenced code blocks become
// `code` nodes (so a heading-like line inside one is never mistaken for a
// section heading), and YAML frontmatter becomes a single node (so YAML
// comments starting with `#` aren't either). The new line is then spliced
// into the raw string at the AST-derived line index, preserving the rest of
// the file byte-for-byte (tabs, `*`/`+` bullets, blank lines) — there is no
// full re-serialize, so no normalization side effects.

type MdastRoot = ReturnType<typeof fromMarkdown>;

/** Parse markdown to an mdast tree with YAML frontmatter parsed as a single
 *  node (its body isn't scanned for headings). Node positions are 1-based. */
export function parseMarkdownAst(content: string): MdastRoot {
  return fromMarkdown(content, {
    extensions: [frontmatter(["yaml"])],
    mdastExtensions: [frontmatterFromMarkdown(["yaml"])],
  });
}

/** Concatenate the text content of a node (handles text inside headings). */
function nodeText(node: { value?: string; children?: unknown[] }): string {
  if (typeof node.value === "string") return node.value;
  if (Array.isArray(node.children)) {
    return node.children
      .map((c) => nodeText(c as { value?: string; children?: unknown[] }))
      .join("");
  }
  return "";
}

/** 1-based start line of the first top-level heading whose text equals `title`
 *  (any depth). Returns -1 if not found. Code blocks and frontmatter are
 *  separate node types, so heading-like text inside them never matches. */
function findHeadingLine(root: MdastRoot, title: string): number {
  for (const child of root.children) {
    if (child.type === "heading" && nodeText(child).trim() === title) {
      return child.position?.start.line ?? -1;
    }
  }
  return -1;
}

interface SectionEndOptions {
  /** Whether a heading at the given depth ends the section. */
  headingEnds: (depth: number) => boolean;
  /** Whether a thematic break (`---`) ends the section. */
  thematicBreakEnds: boolean;
}

/** 1-based start line of the first top-level node after `afterLine` that ends
 *  the section (per `opts`). Returns `eofLine` if none. */
function findSectionEndLine(
  root: MdastRoot,
  afterLine: number,
  opts: SectionEndOptions,
  eofLine: number
): number {
  for (const child of root.children) {
    const line = child.position?.start.line;
    if (line === undefined || line <= afterLine) continue;
    if (child.type === "thematicBreak" && opts.thematicBreakEnds) return line;
    if (child.type === "heading" && opts.headingEnds(child.depth)) return line;
  }
  return eofLine;
}

type AstNodeLike = {
  type?: string;
  position?: { start: { line: number }; end: { line: number } };
  children?: AstNodeLike[];
};

/** 1-based line numbers covered by any `code` node (fenced or indented), so
 *  line-based scans can avoid treating code-block content as tasks. Walks the
 *  whole tree (code can nest inside list items). */
export function collectCodeLines(root: MdastRoot): Set<number> {
  const codeLines = new Set<number>();
  const visit = (node: AstNodeLike): void => {
    if (node.type === "code" && node.position) {
      for (let l = node.position.start.line; l <= node.position.end.line; l++) {
        codeLines.add(l);
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(root as AstNodeLike);
  return codeLines;
}

// ── Markdown line manipulation ─────────────────────────

/** Append a patch line to the ## 追加记录 section of an inspiration body.
 *  If the section doesn't exist, create it at the end of the body.
 *
 *  The section is located via mdast (code-block- and frontmatter-safe); the
 *  patch line is spliced into the raw body, leaving everything else intact. */
export function appendInspirationPatchLine(
  body: string,
  patchLine: string
): string {
  const lines = body.split("\n");
  const root = parseMarkdownAst(body);
  const headingLine = findHeadingLine(root, "追加记录"); // 1-based, -1 if absent

  if (headingLine === -1) {
    // No section — append a new one at the end.
    return body.trimEnd() + `\n\n## 追加记录\n\n${patchLine}\n`;
  }

  // Section ends at the next heading of any depth (NOT at `---`).
  const endLine = findSectionEndLine(
    root,
    headingLine,
    { headingEnds: () => true, thematicBreakEnds: false },
    lines.length + 1
  );
  const headingStart = headingLine - 1; // 0-based
  let insertAt = endLine - 1; // 0-based; === lines.length when EOF
  while (insertAt > headingStart + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }
  lines.splice(insertAt, 0, patchLine);
  return lines.join("\n");
}

/**
 * Insert a new subtask line into raw markdown content right after
 * the last existing subtask of the given parent task.
 *
 * @param content  Full raw markdown content
 * @param parentTask  The parent task under which to insert
 * @param subtaskText  Text for the new subtask
 * @returns Updated markdown content
 */
export function insertSubtaskLine(
  content: string,
  parentTask: DailyTask,
  subtaskText: string
): string {
  const lines = content.split("\n");
  // Code-block line set (1-based) so a task-like line inside a fenced/indented
  // code block can't extend the subtree scan.
  const codeLines = collectCodeLines(parseMarkdownAst(content));
  const parentIndentLen = parentTask.indent.length;
  // Always indent subtasks one tab per level (top-level parent -> "\t",
  // level-1 parent -> "\t\t"). This matches the rollover output's tab
  // convention and avoids tab/space mixes when the parent was authored in
  // Obsidian (tabs) vs the web app. Derived from indentLevel so the parent's
  // raw tab/space characters don't leak into the child's indent.
  const subIndent = "\t".repeat(parentTask.indentLevel + 1);
  const newLine = `${subIndent}- [ ] ${subtaskText}`;

  // Start from the parent line, scan forward to find the last subtask
  let insertAt = parentTask.lineNumber;

  for (let i = parentTask.lineNumber + 1; i < lines.length; i++) {
    const line = lines[i];
    if (codeLines.has(i + 1)) break; // inside a code block → end of subtree
    const match = line.match(/^(\s*)[-+*]\s*\[/);
    if (match) {
      // Task line — check if it's a deeper subtask
      if (match[1].length > parentIndentLen) {
        insertAt = i;
      } else {
        break; // back to same or shallower level — stop
      }
    } else if (line.trim() === "") {
      insertAt = i; // blank line — skip over it
    } else {
      break; // non-task, non-blank line — stop
    }
  }

  lines.splice(insertAt + 1, 0, newLine);
  return lines.join("\n");
}

/**
 * Insert a new top-level task line into the "# 当日日程" section.
 *
 * The section is located via mdast (so a `# 当日日程` line inside a fenced code
 * block can't mis-locate it). The section ends at the next H1 heading or `---`.
 * The task line is spliced in before any trailing blank lines. Fallback:
 * append to end of file if the heading isn't found.
 */
export function insertIntoDailySection(
  content: string,
  taskLine: string
): string {
  const lines = content.split("\n");
  const root = parseMarkdownAst(content);
  const startLine = findHeadingLine(root, "当日日程"); // 1-based, -1 if absent

  // Fallback: append to end
  if (startLine === -1) {
    return content.trimEnd() + "\n" + taskLine + "\n";
  }

  // Section ends at the next H1 heading or thematic break (`---`).
  const endLine = findSectionEndLine(
    root,
    startLine,
    { headingEnds: (d) => d === 1, thematicBreakEnds: true },
    lines.length + 1
  );
  const sectionStart = startLine - 1; // 0-based
  let insertAt = endLine - 1; // 0-based; === lines.length when EOF
  while (insertAt > sectionStart + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  lines.splice(insertAt, 0, taskLine);
  return lines.join("\n");
}

/**
 * Append a timestamped note line to the ## 今日杂记 section.
 * If the section doesn't exist, creates it after # 本日总结.
 *
 * Headings are located via mdast (code-block- and frontmatter-safe). The note
 * line is spliced into the raw content, leaving everything else intact.
 */
export function insertIntoDailyNotesSection(
  content: string,
  time: string,
  noteText: string
): string {
  const lines = content.split("\n");
  const noteLine = `- **${time}** ${noteText}`;
  const root = parseMarkdownAst(content);

  // 1) Try to find ## 今日杂记 (any heading level)
  const notesStartLine = findHeadingLine(root, "今日杂记"); // 1-based, -1 if absent

  if (notesStartLine === -1) {
    // Create the section after # 本日总结 (any heading level)
    const summaryStartLine = findHeadingLine(root, "本日总结"); // 1-based
    if (summaryStartLine === -1) {
      // Fallback: append to end
      return content.trimEnd() + "\n\n## 今日杂记\n\n" + noteLine + "\n";
    }
    const summaryStart = summaryStartLine - 1; // 0-based
    // Skip blank lines after # 本日总结, then insert the new section heading + note
    let insertAt = summaryStart + 1;
    while (insertAt < lines.length && lines[insertAt].trim() === "") {
      insertAt++;
    }
    lines.splice(insertAt, 0, "", "## 今日杂记", "", noteLine);
    return lines.join("\n");
  }

  // 2) 今日杂记 found — section ends at the next H1 heading or `---`.
  const endLine = findSectionEndLine(
    root,
    notesStartLine,
    { headingEnds: (d) => d === 1, thematicBreakEnds: true },
    lines.length + 1
  );
  const notesStart = notesStartLine - 1; // 0-based
  let insertAt = endLine - 1; // 0-based; === lines.length when EOF
  while (insertAt > notesStart + 1 && lines[insertAt - 1].trim() === "") {
    insertAt--;
  }

  lines.splice(insertAt, 0, noteLine);
  return lines.join("\n");
}

/**
 * Remove stale `%%TODO_PLACEHOLDER%%` markers. The diary template carries this
 * token as the rollover-injection point; when a journal is created from the
 * template without rollover tasks to inject (e.g. the web "create today" path,
 * or addNote/pushIdea creating a missing journal), the token must be stripped.
 * Drops a line that is only the placeholder, and removes the token inline
 * elsewhere. Also cleans any leftover tokens after a rollover injection.
 */
export function stripStalePlaceholder(content: string): string {
  return content
    .split("\n")
    .filter((line) => line.trim() !== "%%TODO_PLACEHOLDER%%")
    .map((line) => line.replace(/%%TODO_PLACEHOLDER%%/g, ""))
    .join("\n");
}
