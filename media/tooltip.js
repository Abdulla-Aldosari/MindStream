/*-------------------------------------------------
 * MindStream — VS Code Extension
 * Copyright (c) 2026 Abdulla Aldosari
 * Licensed under MIT
 * See LICENSE in the project root for details.
 *-------------------------------------------------*/

// Reusable data-tooltip system for the webview UI. Any element carrying a
// `data-tooltip` attribute automatically gets a themed tooltip, with no extra
// JS wiring required at the call site. Supported attributes:
//
//   data-tooltip         - body text (bold), required. Injected via
//                          innerHTML, so only trusted content, never raw
//                          user input.
//   data-tooltip-header  - header text (small, muted), optional.
//   data-tooltip-footer  - footer text (small, muted, below a divider),
//                          optional.
//   data-tooltip-pos     - 'top' | 'bottom' (default) | 'left' | 'right'.
//
// computeTooltipPosition(), buildTooltipHtml(), and isLayoutInducedHover()
// are pure, side-effect-free functions kept at the top level (same pattern
// as media/iconClass.js) so they can be exercised directly from Node-based
// unit tests without any DOM/vscode stubbing. The rest of this file wires
// them to real DOM events and only runs inside a real webview (guarded by
// `typeof document !== 'undefined'`), so it has no effect when this file is
// `require()`-d from a Mocha test.

/**
 * Computes where a tooltip box should be placed relative to a target
 * rectangle, clamped to stay fully inside the viewport, flipping to the
 * opposite side when there isn't enough room on the requested side.
 *
 * @param {object} opts
 * @param {{left:number, top:number, right:number, bottom:number, width:number, height:number}} opts.target
 * @param {number} opts.tipWidth
 * @param {number} opts.tipHeight
 * @param {number} opts.viewportWidth
 * @param {number} opts.viewportHeight
 * @param {'top'|'bottom'|'left'|'right'} [opts.pos]
 * @param {number} [opts.margin]
 * @returns {{left:number, top:number, resolvedPos:string, arrowX:number, arrowY:number}}
 */
function computeTooltipPosition(opts) {
  const target = opts.target;
  const tipWidth = opts.tipWidth;
  const tipHeight = opts.tipHeight;
  const viewportWidth = opts.viewportWidth;
  const viewportHeight = opts.viewportHeight;
  const pos = opts.pos || "bottom";
  const margin = opts.margin != null ? opts.margin : 6;

  let left;
  let top;
  let resolvedPos = pos;

  if (pos === "left" || pos === "right") {
    if (pos === "left") {
      left = target.left - tipWidth - margin;
      if (left < margin) {
        left = target.right + margin;
        resolvedPos = "right";
      }
    } else {
      left = target.right + margin;
      if (left + tipWidth > viewportWidth - margin) {
        left = target.left - tipWidth - margin;
        resolvedPos = "left";
      }
    }

    top = target.top + target.height / 2 - tipHeight / 2;
    if (top < margin) {
      top = margin;
    } else if (top + tipHeight > viewportHeight - margin) {
      top = viewportHeight - tipHeight - margin;
    }

    const targetCenterY = target.top + target.height / 2;
    const arrowY = Math.min(Math.max(targetCenterY - top, 10), Math.max(tipHeight - 10, 10));
    return { left: left, top: top, resolvedPos: resolvedPos, arrowX: tipWidth / 2, arrowY: arrowY };
  }

  if (pos === "top") {
    top = target.top - tipHeight - margin;
    if (top < margin) {
      top = target.bottom + margin;
      resolvedPos = "bottom";
    }
  } else {
    top = target.bottom + margin;
    if (top + tipHeight > viewportHeight - margin) {
      top = target.top - tipHeight - margin;
      resolvedPos = "top";
    }
  }

  left = target.left + target.width / 2 - tipWidth / 2;
  if (left < margin) {
    left = margin;
  } else if (left + tipWidth > viewportWidth - margin) {
    left = viewportWidth - tipWidth - margin;
  }

  const targetCenterX = target.left + target.width / 2;
  const arrowX = Math.min(Math.max(targetCenterX - left, 10), Math.max(tipWidth - 10, 10));
  return { left: left, top: top, resolvedPos: resolvedPos, arrowX: arrowX, arrowY: tipHeight / 2 };
}

/**
 * Builds the inner HTML of the tooltip box from its (optional) header, its
 * body, and its (optional) footer. Each section is only rendered when its
 * text is a non-empty string; the divider before the footer is only added
 * when the footer is present.
 *
 * @param {string} [header]
 * @param {string} [body]
 * @param {string} [footer]
 * @returns {string}
 */
function buildTooltipHtml(header, body, footer) {
  const parts = [];
  if (header) {
    parts.push('<div class="tooltip-header">' + header + "</div>");
  }
  if (body) {
    parts.push('<div class="tooltip-body">' + body + "</div>");
  }
  if (footer) {
    parts.push('<div class="tooltip-divider"></div><div class="tooltip-footer">' + footer + "</div>");
  }
  return parts.join("");
}

/**
 * Decides whether a `mouseover` event should be ignored because the pointer
 * has not actually moved. Browsers re-dispatch `mouseover` when a layout
 * change (e.g. the VS Code window being resized) slides a different element
 * under a stationary pointer, which would otherwise show tooltips without
 * any real hover. A hover is treated as genuine only when the event's
 * coordinates differ from the last known pointer position, or when a
 * `mousemove` with the same coordinates happened within `threshold` ms -
 * the normal case where the user moves the pointer across an element
 * boundary, since the final `mousemove` and the crossing `mouseover` share
 * the same coordinates.
 *
 * @param {object} opts
 * @param {number} opts.timeStamp - `e.timeStamp` of the mouseover event.
 * @param {number} opts.clientX - `e.clientX` of the mouseover event.
 * @param {number} opts.clientY - `e.clientY` of the mouseover event.
 * @param {number|null} opts.lastMoveX - `clientX` of the last mousemove, or null if none seen yet.
 * @param {number|null} opts.lastMoveY - `clientY` of the last mousemove, or null if none seen yet.
 * @param {number} opts.lastMoveTimeStamp - `timeStamp` of the last mousemove, or 0 if none seen yet.
 * @param {number} [opts.threshold] - max age in ms for the last mousemove to still count as recent.
 * @returns {boolean} true when the hover is layout-induced and should be ignored.
 */
function isLayoutInducedHover(opts) {
  const threshold = opts.threshold != null ? opts.threshold : 150;
  if (opts.lastMoveX == null || opts.lastMoveY == null) {
    return false;
  }
  if (opts.clientX !== opts.lastMoveX || opts.clientY !== opts.lastMoveY) {
    return false;
  }
  return opts.timeStamp - opts.lastMoveTimeStamp > threshold;
}

// This branch only runs inside the real webview. It never executes when
// this file is `require()`-d from a Node-based unit test, where `document`
// is undefined.
if (typeof document !== "undefined") {
  (function () {
    const VALID_POS = ["top", "bottom", "left", "right"];
    const SHOW_DELAY = 500;

    let tooltipEl = null;
    let showTimer = null;
    let currentTarget = null;
    let rafId = null;
    let lastAppliedPos = null;
    let lastMoveX = null;
    let lastMoveY = null;
    let lastMoveTimeStamp = 0;

    function ensureTooltip() {
      if (tooltipEl) {
        return tooltipEl;
      }
      tooltipEl = document.createElement("div");
      tooltipEl.className = "tooltip";
      document.body.appendChild(tooltipEl);
      return tooltipEl;
    }

    function findTooltipTarget(node) {
      return node && node.closest ? node.closest("[data-tooltip]") : null;
    }

    // Suppresses any tooltip whose target sits outside a currently open
    // menu (e.g. a custom-select dropdown's .cs-menu, identified generically
    // via the standard `role="menu"` ARIA attribute rather than any
    // dropdown-specific class, so this stays reusable by any future open
    // overlay that follows the same ARIA pattern). Without this, a button
    // that opens a menu right below itself (like a dropdown's .cs-btn)
    // keeps showing its own tooltip while hovered, which then visually
    // overlaps the first menu item. Tooltips for elements *inside* the open
    // menu itself (e.g. a per-option data-tooltip on a .cs-item) are still
    // allowed, since that is the only time those items are visible/hoverable
    // at all.
    function isSuppressedByOpenMenu(target) {
      const openMenus = document.querySelectorAll('[role="menu"]:not([hidden])');
      for (let i = 0; i < openMenus.length; i++) {
        if (!openMenus[i].contains(target)) {
          return true;
        }
      }
      return false;
    }

    function clearShowTimer() {
      if (showTimer) {
        clearTimeout(showTimer);
        showTimer = null;
      }
    }

    function stopTracking() {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    function hideTooltip() {
      clearShowTimer();
      stopTracking();
      currentTarget = null;
      lastAppliedPos = null;
      if (tooltipEl) {
        tooltipEl.classList.remove("visible");
      }
    }

    function positionTooltip(target) {
      const tip = ensureTooltip();
      const rect = target.getBoundingClientRect();
      const requestedPos = VALID_POS.indexOf(target.dataset.tooltipPos) !== -1 ? target.dataset.tooltipPos : "bottom";
      const result = computeTooltipPosition({
        target: rect,
        tipWidth: tip.offsetWidth,
        tipHeight: tip.offsetHeight,
        viewportWidth: document.documentElement.clientWidth,
        viewportHeight: document.documentElement.clientHeight,
        pos: requestedPos,
      });

      // Skip the DOM writes entirely when nothing moved since the last
      // frame. The rAF loop still runs (it must keep detecting target
      // removal / FLIP movement), but rewriting style and pos-* classes
      // ~60 times per second while the target is stationary made DevTools
      // flash the class attribute aggressively and forced needless style
      // recalculation. Comparing against the last applied values keeps
      // every frame's read cheap and only touches the DOM on real change.
      if (
        lastAppliedPos &&
        lastAppliedPos.left === result.left &&
        lastAppliedPos.top === result.top &&
        lastAppliedPos.arrowX === result.arrowX &&
        lastAppliedPos.arrowY === result.arrowY &&
        lastAppliedPos.resolvedPos === result.resolvedPos
      ) {
        return;
      }

      tip.style.left = result.left + "px";
      tip.style.top = result.top + "px";
      tip.style.setProperty("--arrow-x", result.arrowX + "px");
      tip.style.setProperty("--arrow-y", result.arrowY + "px");
      tip.classList.remove("pos-top", "pos-bottom", "pos-left", "pos-right");
      tip.classList.add("pos-" + result.resolvedPos);

      lastAppliedPos = {
        left: result.left,
        top: result.top,
        arrowX: result.arrowX,
        arrowY: result.arrowY,
        resolvedPos: result.resolvedPos,
      };
    }

    // Recomputes the tooltip's position on every frame while it is visible,
    // so it follows the target if it moves in the background (e.g. a FLIP
    // reorder animation) and disappears immediately if the target is removed
    // from the DOM, instead of staying stuck on stale coordinates.
    function trackTarget() {
      stopTracking();
      function tick() {
        if (!currentTarget || !document.body.contains(currentTarget) || isSuppressedByOpenMenu(currentTarget)) {
          hideTooltip();
          return;
        }
        positionTooltip(currentTarget);
        rafId = requestAnimationFrame(tick);
      }
      rafId = requestAnimationFrame(tick);
    }

    function revealTooltip(target) {
      // A menu may have opened during the show delay (e.g. the target is a
      // dropdown button clicked while its own tooltip was still pending).
      if (isSuppressedByOpenMenu(target)) {
        return;
      }
      const tip = ensureTooltip();
      tip.innerHTML = buildTooltipHtml(
        target.dataset.tooltipHeader,
        target.dataset.tooltip,
        target.dataset.tooltipFooter
      );
      tip.classList.add("visible");
      positionTooltip(target);
      trackTarget();
    }

    function activateTooltip(target) {
      if (target === currentTarget || isSuppressedByOpenMenu(target)) {
        return;
      }
      hideTooltip();
      currentTarget = target;
      clearShowTimer();
      showTimer = setTimeout(function () {
        showTimer = null;
        revealTooltip(target);
      }, SHOW_DELAY);
    }

    function isMovingWithin(target, relatedTarget) {
      return !!(relatedTarget && target.contains && target.contains(relatedTarget));
    }

    // Records the last known pointer position and its timestamp so the
    // mouseover handler can tell a real hover (mouse actually moved) apart
    // from a layout-induced one (an element slid under a stationary pointer,
    // e.g. when the VS Code window is resized). Only numeric writes, no DOM
    // reads or allocations, so it costs nothing even though mousemove fires
    // frequently. `e.timeStamp` is reused instead of Date.now() to avoid
    // even the clock read.
    document.addEventListener("mousemove", function (e) {
      lastMoveX = e.clientX;
      lastMoveY = e.clientY;
      lastMoveTimeStamp = e.timeStamp;
    });

    document.addEventListener("mouseover", function (e) {
      const target = findTooltipTarget(e.target);
      if (!target || isMovingWithin(target, e.relatedTarget)) {
        return;
      }
      if (
        isLayoutInducedHover({
          timeStamp: e.timeStamp,
          clientX: e.clientX,
          clientY: e.clientY,
          lastMoveX: lastMoveX,
          lastMoveY: lastMoveY,
          lastMoveTimeStamp: lastMoveTimeStamp,
        })
      ) {
        return;
      }
      activateTooltip(target);
    });

    document.addEventListener("mouseout", function (e) {
      const target = findTooltipTarget(e.target);
      if (!target || isMovingWithin(target, e.relatedTarget)) {
        return;
      }
      hideTooltip();
    });

    document.addEventListener("focusin", function (e) {
      const target = findTooltipTarget(e.target);
      if (!target) {
        return;
      }
      activateTooltip(target);
    });

    document.addEventListener("focusout", hideTooltip);

    // Hide on any pointer-down anywhere, including on the tooltip's own
    // target, matching VS Code's native hover behavior. Capture phase so it
    // fires even when a click handler further down stops propagation.
    document.addEventListener("pointerdown", hideTooltip, true);

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        hideTooltip();
      }
    });

    // Scroll events do not bubble, so listen in the capture phase to catch
    // the list and any nested scroller; otherwise a `position: fixed`
    // tooltip stays stuck in place while content scrolls beneath a
    // stationary mouse cursor.
    window.addEventListener("scroll", hideTooltip, true);
    window.addEventListener("blur", hideTooltip);
  })();
}

// Exposes the pure functions to Node-based unit tests. This branch never
// executes inside the real webview, where `module` is undefined, so it has
// no effect on production behavior.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeTooltipPosition: computeTooltipPosition,
    buildTooltipHtml: buildTooltipHtml,
    isLayoutInducedHover: isLayoutInducedHover,
  };
}
