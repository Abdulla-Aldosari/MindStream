/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Shared pieces of task group notes: the progress bar (cards and viewer) and
// the task checkbox (viewer and editor).

const CHECK_SVG =
  '<svg viewBox="0 0 12 12" focusable="false" aria-hidden="true"><path d="M3 6.5 5.2 8.7 9 4.2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// A progress bar for `tasks`: completed / total, in any completion order.
// The fill width is the `--task-progress` custom property (no inline style).
export function buildProgressBar(tasks) {
  const { done, total, percent } = TaskList.progress(tasks);
  const wrap = document.createElement("div");
  wrap.className = "task-progress" + (total > 0 && done === total ? " complete" : "");
  wrap.setAttribute("role", "progressbar");
  wrap.setAttribute("aria-valuemin", "0");
  wrap.setAttribute("aria-valuemax", String(total));
  wrap.setAttribute("aria-valuenow", String(done));
  wrap.setAttribute("aria-valuetext", `${done} of ${total} tasks completed`);

  // Marks the note as a task group at a glance.
  const icon = document.createElement("span");
  icon.className = "codicon codicon-checklist task-progress-icon";
  icon.setAttribute("aria-hidden", "true");
  wrap.appendChild(icon);

  const track = document.createElement("div");
  track.className = "task-progress-track";
  const fill = document.createElement("div");
  fill.className = "task-progress-fill";
  fill.style.setProperty("--task-progress", percent + "%");
  track.appendChild(fill);
  wrap.appendChild(track);

  const label = document.createElement("span");
  label.className = "task-progress-label";
  label.setAttribute("aria-hidden", "true");
  label.textContent = `${done}/${total}`;
  wrap.appendChild(label);
  return wrap;
}

// A checkbox button for one task. The caller wires the click and keeps
// `aria-checked` in sync through setTaskCheck().
export function buildTaskCheck(completed, label) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "task-check";
  btn.setAttribute("role", "checkbox");
  btn.setAttribute("aria-label", label);
  btn.innerHTML = CHECK_SVG;
  setTaskCheck(btn, completed);
  return btn;
}

export function setTaskCheck(btn, completed) {
  btn.setAttribute("aria-checked", completed ? "true" : "false");
}
