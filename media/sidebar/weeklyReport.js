/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The weekly report modal.

import { $ } from "./core.js";
import { closeAllModals } from "./overlays.js";
import { buildReportCard } from "./card.js";

// --- Weekly report modal ---

export function openWeeklyReportModal(report) {
  closeAllModals();
  renderWeeklyReport(report);
  $("report-modal").hidden = false;
}

export function closeWeeklyReport() {
  $("report-modal").hidden = true;
}

function renderWeeklyReport(report) {
  $("report-title").textContent = `Weekly Report — Week of ${report.weekLabel}`;

  const summary = $("report-summary");
  summary.innerHTML = "";
  summary.appendChild(reportStat("Created this week", `${report.createdCount} notes`));
  summary.appendChild(reportStat("Completed this week", `${report.completedCount} notes`));
  summary.appendChild(reportStat("Currently in progress", `${report.inProgressCount} notes`));
  summary.appendChild(reportStat("Archived this week", `${report.archivedCount} notes`));

  const body = $("report-body");
  body.innerHTML = "";
  const completed = report.completed || [];
  const inProgress = report.inProgress || [];
  if (inProgress.length) {
    body.appendChild(reportSectionHeader("In progress", inProgress.length));
    inProgress.forEach((it) => body.appendChild(buildReportCard(it)));
  }
  if (completed.length) {
    body.appendChild(reportSectionHeader("Completed", completed.length));
    completed.forEach((it) => body.appendChild(buildReportCard(it)));
  }
  if (!completed.length && !inProgress.length) {
    const empty = document.createElement("div");
    empty.className = "report-empty";
    empty.textContent = "No completed or in-progress notes this week.";
    body.appendChild(empty);
  }
}

function reportStat(label, value) {
  const row = document.createElement("div");
  row.className = "report-stat";
  const l = document.createElement("span");
  l.className = "report-stat-label";
  l.textContent = label;
  const v = document.createElement("span");
  v.className = "report-stat-value";
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

function reportSectionHeader(label, count) {
  const h = document.createElement("div");
  h.className = "report-section-header";
  h.textContent = `${label} (${count})`;
  return h;
}

export function initWeeklyReport() {
  $("report-close").addEventListener("click", closeWeeklyReport);
}
