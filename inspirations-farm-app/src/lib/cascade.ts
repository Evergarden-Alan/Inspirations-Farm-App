/**
 * Task toggle with line-based downward cascade and upward parent recomputation.
 *
 * Works directly on raw markdown content rather than parsed DailyTask arrays,
 * avoiding false matches from String.replace when tasks share the same text.
 */

const TASK_RE = /^(\s*)-\s*\[([ xX])\]\s+(.*)$/;

/** Count leading whitespace — each space = 1, each tab = 2. */
function countIndent(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === " ") n++;
    else if (ch === "\t") n += 2;
    else break;
  }
  return n;
}

/** Flip a checkbox: - [ ] ↔ - [x] */
function toggleCheckbox(line: string): string {
  if (/^(\s*)-\s*\[[xX]\]/.test(line)) {
    return line.replace(/^(\s*)-\s*\[[xX]\]/, "$1- [ ]");
  }
  return line.replace(/^(\s*)-\s*\[ \]/, "$1- [x]");
}

/** Set a checkbox to a specific state (- [x] or - [ ]). */
function setCheckbox(line: string, done: boolean): string {
  if (done) {
    if (/^(\s*)-\s*\[[xX]\]/.test(line)) return line;
    return line.replace(/^(\s*)-\s*\[ \]/, "$1- [x]");
  } else {
    if (/^(\s*)-\s*\[ \]/.test(line)) return line;
    return line.replace(/^(\s*)-\s*\[[xX]\]/, "$1- [ ]");
  }
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
  const targetWasDone = /^(\s*)-\s*\[[xX]\]/.test(targetLine);

  // 1) Toggle the clicked line
  lines[lineIndex] = toggleCheckbox(targetLine);
  const newDone = !targetWasDone;

  // 2) Downward cascade — sync all deeper descendants
  for (let i = lineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;

    const indent = countIndent(line);
    if (indent <= targetIndent) break; // back to same or shallower level → stop

    const taskMatch = line.match(TASK_RE);
    if (taskMatch) {
      lines[i] = setCheckbox(line, newDone);
    }
    // Non-task lines between siblings (blank already skipped) → skip
  }

  // 3) Upward cascade — recompute ancestors
  recomputeAncestors(lines, lineIndex, targetIndent);

  return lines.join("\n");
}

/**
 * Walk upward from a changed task and recompute each ancestor's checkbox
 * based on whether all of its descendants are done.
 */
function recomputeAncestors(
  lines: string[],
  changedIndex: number,
  changedIndent: number
): void {
  // Find the parent by walking up to the nearest task with less indent
  for (let p = changedIndex - 1; p >= 0; p--) {
    const parentLine = lines[p];
    if (parentLine.trim() === "") continue;

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
      const parentDone = /^(\s*)-\s*\[[xX]\]/.test(parentLine);
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
