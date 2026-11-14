/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Note cards: layout, priority indicator, and the footer actions (status
// cycle, view, edit, archive, delete).

import { esc, state, typeOf, vscode } from "./core.js";
import { buildLinkBadge, linkRowObserver } from "./linkBadge.js";
import { openEdit } from "./noteEditor.js";
import { openView } from "./noteViewer.js";

const STATUS_CYCLE = ["pending", "in-progress", "done"];

function buildCardBase(item) {
  const t = typeOf(item.typeId);
  const card = document.createElement("div");
  card.className = "card" + (item.archived ? " archived" : "");
  card.dataset.id = item.id;
  card.setAttribute("dir", state.direction);

  const head = document.createElement("div");
  head.className = "card-head";

  // Priority indicator (style chosen by the mindstream.priority.style
  // setting). Notes without a priority get none, so unassigned notes are
  // never shown as an implicit level.
  const indicator = state.priority.cardIndicator;
  const level = indicator && state.priority.levels.includes(item.priority) ? item.priority : null;
  const levelText = level ? `Priority: ${state.priority.labels[level] || level}` : "";
  if (level) {
    card.classList.add(`prio-${level}`, `prio-ind-${indicator}`);
  }

  const title = document.createElement("div");
  title.className = "card-title";
  if (level && indicator === "dot") {
    title.appendChild(buildPriorityDot(level, levelText));
  }
  title.appendChild(document.createTextNode(item.title));
  // Stripe styles are color-only; give screen readers the level as text.
  if (level && (indicator === "stripe" || indicator === "typeStripe")) {
    const srText = document.createElement("span");
    srText.className = "sr-only";
    srText.textContent = ` (${levelText})`;
    title.appendChild(srText);
  }
  head.appendChild(title);

  const typeBadge = document.createElement("span");
  typeBadge.className = "card-type";
  typeBadge.innerHTML = `<span class="${iconClass(t.icon)}"></span> ${esc(t.label)}`;
  if (level && indicator === "typeStripe") {
    typeBadge.dataset.tooltip = levelText;
  }
  head.appendChild(typeBadge);
  card.appendChild(head);

  if (item.description) {
    const desc = document.createElement("div");
    desc.className = "card-desc";
    desc.textContent = item.description;
    card.appendChild(desc);
  }

  if (item.link) {
    const linkRow = document.createElement("div");
    linkRow.className = "card-link";
    linkRow.appendChild(buildLinkBadge(item));
    card.appendChild(linkRow);
    linkRowObserver.observe(linkRow);
  }

  const footer = document.createElement("div");
  footer.className = "card-footer";

  // Status + priority chip travel together on the left side.
  const meta = document.createElement("div");
  meta.className = "card-meta";

  const status = document.createElement("span");
  status.className = "status " + item.status;
  status.textContent = state.statusLabels[item.status] || item.status;
  meta.appendChild(status);

  if (level && indicator === "chip") {
    const chip = document.createElement("span");
    chip.className = "prio-chip";
    chip.appendChild(buildPriorityDot(level, ""));
    chip.appendChild(document.createTextNode(state.priority.labels[level] || level));
    meta.appendChild(chip);
  }

  footer.appendChild(meta);
  card.appendChild(footer);

  return card;
}

// Small colored dot for a priority level. With `label`, it is announced to
// screen readers and shows the label as a tooltip; without, it is decorative.
function buildPriorityDot(level, label) {
  const dot = document.createElement("span");
  dot.className = `prio-dot prio-${level}`;
  if (label) {
    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", label);
    dot.dataset.tooltip = label;
  } else {
    dot.setAttribute("aria-hidden", "true");
  }
  return dot;
}

export function buildCard(item) {
  const card = buildCardBase(item);

  const status = card.querySelector(".card-footer .status");
  status.dataset.tooltip = statusTooltip(item.status);
  status.addEventListener("click", (e) => cycleStatus(item, e));

  const footer = card.querySelector(".card-footer");

  // The four card actions travel together on the right side.
  const actions = document.createElement("div");
  actions.className = "card-actions";

  const viewBtn = btnIcon("codicon-eye", "View note", () => openView(item));
  viewBtn.classList.add("card-view-btn");
  actions.appendChild(viewBtn);
  actions.appendChild(btnIcon("codicon-edit", "Edit", () => openEdit(item)));
  actions.appendChild(btnIcon("codicon-archive", item.archived ? "Unarchive" : "Archive", () => toggleArchive(item)));
  actions.appendChild(btnIcon("codicon-trash", "Delete permanently", () => deleteItem(item), true));

  footer.appendChild(actions);

  card.addEventListener("dblclick", (e) => {
    if (e.target.closest("button, .status")) {
      return;
    }
    openView(item);
  });

  return card;
}

export function buildReportCard(item) {
  return buildCardBase(item);
}

function btnIcon(codicon, title, onClick, danger) {
  const b = document.createElement("button");
  b.className = `icon-btn${danger ? " danger" : ""}`;
  b.dataset.tooltip = title;
  b.innerHTML = `<span class="codicon ${codicon}"></span>`;
  b.addEventListener("click", onClick);
  return b;
}

function statusTooltip(status) {
  if (status === "pending") {
    return "Change status to 'In Progress'\nCtrl+Click: Change to 'Done'";
  }
  if (status === "in-progress") {
    return "Change status to 'Done'\nCtrl+Click: Change to 'None'";
  }
  // done
  return "Change status to 'None'";
}

function cycleStatus(item, event) {
  const ctrl = !!(event && (event.ctrlKey || event.metaKey));
  let next;

  if (!ctrl) {
    // Normal click: forward cycle.
    const i = STATUS_CYCLE.indexOf(item.status);
    next = STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
  } else if (item.status === "pending") {
    next = "done";
  } else if (item.status === "in-progress") {
    next = "pending";
  } else {
    // done + Ctrl+Click: no-op
    return;
  }

  vscode.postMessage({ type: "changeStatus", id: item.id, status: next });
}

function toggleArchive(item) {
  vscode.postMessage({ type: "toggleArchive", id: item.id, archived: !item.archived });
}

function deleteItem(item) {
  vscode.postMessage({ type: "deleteItem", id: item.id });
}
