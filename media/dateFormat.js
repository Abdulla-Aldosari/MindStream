/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// The dates shown by the sidebar: dd/MM/yyyy, or dd/MM/yyyy hh:mm:ss AM|PM with the
// time, in the user's local time zone, whatever the display language of VS Code is.
// Side-effect-free (no DOM, no acquireVsCodeApi), so it is loaded as a global
// before sidebar.js and required directly by Mocha tests.

const DateFormat = (() => {
  const pad = (n) => String(n).padStart(2, "0");

  /** `value` (an ISO string or a Date) as dd/MM/yyyy, or "" when it is empty or not a date. */
  function formatDate(value) {
    if (!value) {
      return "";
    }
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
  }

  /**
   * `value` (an ISO string or a Date) as dd/MM/yyyy hh:mm:ss AM|PM, in 12-hour time
   * with two digits for the hour (midnight is 12:00:00 AM, noon is 12:00:00 PM),
   * or "" when it is empty or not a date.
   */
  function formatDateTime(value) {
    const day = formatDate(value);
    if (!day) {
      return "";
    }
    const date = value instanceof Date ? value : new Date(value);
    const hours = date.getHours();
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    const period = hours < 12 ? "AM" : "PM";
    return `${day} ${pad(hour12)}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${period}`;
  }

  return { formatDate, formatDateTime };
})();

// Exposes the helpers to Node-based unit tests. This branch never runs in the
// real webview, where `module` is undefined.
if (typeof module !== "undefined" && module.exports) {
  module.exports = DateFormat;
}
