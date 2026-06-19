import type { DailyTask } from "./github";

/**
 * Compute new tasks state after toggling one task,
 * applying both downward and upward cascades.
 *
 * Downward: all descendants inherit the same done state.
 * Upward: a parent becomes done if all its children are done,
 *         and becomes not-done if any child is not done.
 */
export function cascadeToggle(
  tasks: DailyTask[],
  toggledIndex: number
): DailyTask[] {
  const updated = tasks.map((t) => ({ ...t }));
  const toggled = updated[toggledIndex];
  const newDone = !toggled.done;

  // 1) Toggle the clicked task itself
  toggled.done = newDone;

  // 2) Downward cascade — all deeper descendants get the same state
  for (let i = toggledIndex + 1; i < updated.length; i++) {
    if (updated[i].indentLevel <= toggled.indentLevel) break;
    updated[i].done = newDone;
  }

  // 3) Upward cascade — recompute ancestors
  let current: DailyTask | undefined = toggled;
  while (current.parentId !== null) {
    const parent = updated.find((t) => t.id === current!.parentId);
    if (!parent) break;
    const siblings = updated.filter((t) => t.parentId === parent.id);
    parent.done = siblings.every((s) => s.done);
    current = parent;
  }

  return updated;
}

/**
 * Apply a tasks-array diff back into the raw markdown content.
 * Only lines whose done state changed are replaced.
 * Uses exact string matching with indentation preserved.
 */
export function applyTaskChanges(
  content: string,
  oldTasks: DailyTask[],
  newTasks: DailyTask[]
): string {
  let result = content;

  // Process from bottom to top so earlier indices stay valid
  for (let i = newTasks.length - 1; i >= 0; i--) {
    const old = oldTasks[i];
    const neo = newTasks[i];
    if (old.done === neo.done) continue;

    const oldLine = `${old.indent}- [${old.done ? "x" : " "}] ${old.text}`;
    const newLine = `${neo.indent}- [${neo.done ? "x" : " "}] ${neo.text}`;

    result = result.replace(oldLine, newLine);
  }

  return result;
}
