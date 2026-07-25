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
const CHECKBOX_PREFIX_RE = /^(\s*)([-+*])\s*\[([ xX])\]/;

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

/** Flip a checkbox: [ ] ↔ [x], preserving the bullet (-, *, or +). */
function toggleCheckbox(line: string): string {
  const m = line.match(CHECKBOX_PREFIX_RE);
  if (!m) return line;
  const [, indent, bullet, state] = m;
  const newMark = state === " " ? "x" : " ";
  return `${indent}${bullet} [${newMark}]${line.slice(m[0].length)}`;
}

/** Set a checkbox to a specific state ([x] or [ ]), preserving the bullet. */
function setCheckbox(line: string, done: boolean): string {
  const m = line.match(CHECKBOX_PREFIX_RE);
  if (!m) return line;
  const [, indent, bullet, state] = m;
  if (done === (state !== " ")) return line; // already in the desired state
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
  const lines = content.split("\n");
  const targetLine = lines[lineIndex];
  const targetIndent = countIndent(targetLine);
  const targetWasDone = DONE_TASK_RE.test(targetLine);

  // Build a set of line numbers inside fenced code blocks to skip them
  const codeLines = collectCodeLines(parseMarkdownAst(content));

  // 1) Toggle the clicked line
  lines[lineIndex] = toggleCheckbox(targetLine);
  const newDone = !targetWasDone;

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
      lines[i] = setCheckbox(line, newDone);
    }
    // Non-task lines between siblings (blank already skipped) → skip
  }

  // 3) Upward cascade — recompute ancestors
  recomputeAncestors(lines, lineIndex, targetIndent, codeLines);

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
        if (descMatch[2] === " ") {
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
