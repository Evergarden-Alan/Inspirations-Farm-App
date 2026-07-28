/**
 * Task toggle with line-based downward cascade and upward parent recomputation.
 *
 * Works directly on raw markdown content rather than parsed DailyTask arrays,
 * avoiding false matches from String.replace when tasks share the same text.
 */

import { parseMarkdownAst, collectCodeLines } from "./markdown-utils";

const TASK_RE = /^(\s*)[-+*]\s*\[([ xX>])\]\s+(.*)$/;

/** Leading indent + bullet (-, *, or +) + checkbox state. Captures the bullet
 *  so toggle/set can preserve it instead of forcing "-". */
const CHECKBOX_PREFIX_RE = /^(\s*)([-+*])\s*\[([ xX>])\]/;

/** A task line whose checkbox is done ([x] or [X]), any bullet. */
const DONE_TASK_RE = /^(\s*)[-+*]\s*\[[xX]\]/;

/** Count leading whitespace — normalise tabs to 2 spaces for consistent depth. */
function countIndent(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

/** Set a checkbox to a specific state ([x] or [ ]), preserving the bullet. */
function setCheckbox(line: string, done: boolean): string {
  const m = line.match(CHECKBOX_PREFIX_RE);
  if (!m) return line;
  const [, indent, bullet, state] = m;
  if (done === (state.toLowerCase() === "x")) return line;
  const newMark = done ? "x" : " ";
  return `${indent}${bullet} [${newMark}]${line.slice(m[0].length)}`;
}

/**
 * Toggle a task checkbox at the given line index and cascade the change
 * to all nested descendants. Also recomputes ancestor states upward.
 *
 * @param content  Raw markdown content of the daily journal.
 * @param lineIndex  Index of the line being toggled (0-based, in content.split('\n')).
 * @returns  Updated markdown content.
 */
export function cascadeToggleAtLine(
  content: string,
  lineIndex: number
): string {
  const targetLine = content.split("\n")[lineIndex];
  if (!targetLine || !TASK_RE.test(targetLine)) return content;

  return cascadeSetAtLine(content, lineIndex, !DONE_TASK_RE.test(targetLine));
}

/** Set a task and its descendants to a specific state, then recompute parents. */
export function cascadeSetAtLine(
  content: string,
  lineIndex: number,
  done: boolean
): string {
  const lines = content.split("\n");
  const targetLine = lines[lineIndex];
  if (!targetLine || !TASK_RE.test(targetLine)) return content;

  const targetIndent = countIndent(targetLine);

  // Build a set of line numbers inside fenced code blocks to skip them
  const codeLines = collectCodeLines(parseMarkdownAst(content));
  if (codeLines.has(lineIndex + 1)) return content;

  // 1) Set the selected line to the requested state.
  lines[lineIndex] = setCheckbox(targetLine, done);

  // 2) Downward cascade — sync all deeper descendants
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    // Skip lines inside fenced code blocks - don't cascade into code examples
    if (codeLines.has(i + 1)) continue;

    const indent = countIndent(line);
    if (indent <= targetIndent) break; // back to same or shallower level → stop

    const taskMatch = line.match(TASK_RE);
    if (taskMatch) {
      lines[i] = setCheckbox(line, done);
    }
    // Non-task lines between siblings (blank already skipped) → skip
  }

  // 3) Upward cascade — recompute ancestors
  recomputeAncestors(lines, lineIndex, targetIndent, codeLines);

  return lines.join("\n");
}

/**
 * Delete a task and all content nested beneath it. Blank lines immediately
 * before the next sibling are preserved so section spacing remains intact.
 * Ancestor completion states are recomputed from the remaining children.
 */
export function deleteTaskSubtreeAtLine(
  content: string,
  lineIndex: number
): string {
  const lines = content.split("\n");
  const targetLine = lines[lineIndex];
  if (!targetLine) return content;

  const codeLines = collectCodeLines(parseMarkdownAst(content));
  if (codeLines.has(lineIndex + 1) || !TASK_RE.test(targetLine)) return content;

  const targetIndent = countIndent(targetLine);
  let deleteEnd = lineIndex + 1;

  for (let i = lineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    if (countIndent(line) <= targetIndent) break;
    deleteEnd = i + 1;
  }

  lines.splice(lineIndex, deleteEnd - lineIndex);

  const updatedContent = lines.join("\n");
  const updatedCodeLines = collectCodeLines(parseMarkdownAst(updatedContent));
  recomputeAncestors(lines, lineIndex, targetIndent, updatedCodeLines);

  return lines.join("\n");
}

/**
 * Walk upward from a changed task and recompute each ancestor's checkbox
 * based on whether all of its descendants are done.
 */
function recomputeAncestors(
  lines: string[],
  changedIndex: number,
  changedIndent: number,
  codeLines: Set<number>
): void {
  // Find the parent by walking up to the nearest task with less indent
  for (let p = changedIndex - 1; p >= 0; p--) {
    const parentLine = lines[p];
    if (parentLine.trim() === "") continue;

    // Skip lines inside fenced code blocks
    if (codeLines.has(p + 1)) continue;

    const parentIndent = countIndent(parentLine);
    if (parentIndent >= changedIndent) continue; // sibling or child — keep going up

    const parentMatch = parentLine.match(TASK_RE);
    if (!parentMatch) continue; // non-task line — skip

    // Found a parent — scan all descendants and check if all are done
    let allDone = true;
    let hasDescendants = false;

    for (let d = p + 1; d < lines.length; d++) {
      const descLine = lines[d];
      if (descLine.trim() === "") continue;

      // Skip lines inside fenced code blocks when checking descendants
      if (codeLines.has(d + 1)) continue;

      const descIndent = countIndent(descLine);
      if (descIndent <= parentIndent) break; // past this parent's subtree

      const descMatch = descLine.match(TASK_RE);
      if (descMatch) {
        hasDescendants = true;
        if (descMatch[2].toLowerCase() !== "x") {
          allDone = false;
        }
      }
    }

    if (hasDescendants) {
      const parentDone = DONE_TASK_RE.test(parentLine);
      if (allDone !== parentDone) {
        lines[p] = setCheckbox(parentLine, allDone);
        // Continue upward with this parent as the changed node
        changedIndent = parentIndent;
        continue; // keep walking up
      }
    }
    break; // parent state unchanged — ancestors above it are unaffected
  }
}
