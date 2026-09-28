// ==UserScript==
// @name         YouTube Hide Playing Video
// @namespace    local.hide-yt-video
// @version      1.1.0
// @description  Hide or show the playing YouTube video from a button left of the like button
// @match        https://www.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'yt-hide-video-btn';
  const OVERLAY_ID = 'yt-hide-video-overlay';
  const HIDDEN_CLASS = 'yt-hide-playing-video';
  const STORAGE_KEY = 'yt-hide-playing-video';
  const STROKE = '.ytSpecTouchFeedbackShapeStroke, .yt-spec-touch-feedback-shape__stroke';

  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75C21.27 7.61 17 4.5 12 4.5c-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';

  const style = document.createElement('style');
  style.textContent = `
    html.${HIDDEN_CLASS} #movie_player .html5-video-container,
    html.${HIDDEN_CLASS} #movie_player .ytp-cued-thumbnail-overlay,
    html.${HIDDEN_CLASS} #movie_player .ytp-ce-element,
    html.${HIDDEN_CLASS} #movie_player .ytp-endscreen-content,
    html.${HIDDEN_CLASS} #movie_player .ytp-upnext,
    html.${HIDDEN_CLASS} #movie_player .ytp-videowall-still {
      opacity: 0 !important;
      visibility: hidden !important;
    }
    #${OVERLAY_ID} {
      display: none;
      position: absolute;
      inset: 0 0 48px 0;
      z-index: 20;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      color: var(--yt-spec-text-secondary, #aaa);
      font: 500 15px Roboto, Arial, sans-serif;
    }
    html.${HIDDEN_CLASS} #${OVERLAY_ID} { display: flex; }
    #${BTN_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      align-self: center;
      flex: 0 0 auto;
      width: 36px;
      height: 36px;
      margin: 0 8px 0 0;
      padding: 0;
      border: 0;
      border-radius: 18px;
      cursor: pointer;
      color: var(--yt-spec-text-primary, inherit);
      background: var(--yt-spec-badge-chip-background, rgba(128, 128, 128, 0.18));
    }
    #${BTN_ID}:hover {
      background: var(--yt-spec-badge-chip-background-hover, rgba(128, 128, 128, 0.28));
    }
    #${BTN_ID}[aria-pressed="true"] {
      color: var(--yt-spec-base-background, #0f0f0f);
      background: var(--yt-spec-text-primary, #fff);
    }
    #${BTN_ID} svg { display: block; }
  `;
  document.documentElement.appendChild(style);

  function hidden() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function paint() {
    const on = hidden();
    document.documentElement.classList.toggle(HIDDEN_CLASS, on);
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on ? 'Show video' : 'Hide video');
    btn.title = on ? 'Show video' : 'Hide video';
    btn.innerHTML = on ? EYE : EYE_OFF;
  }

  function deepQuery(root, selector) {
    const found = [];
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || (node.nodeType !== 1 && node.nodeType !== 11)) continue;
      if (node.querySelectorAll) node.querySelectorAll(selector).forEach((el) => found.push(el));
      node.querySelectorAll?.('*').forEach((el) => {
        if (el.shadowRoot) stack.push(el.shadowRoot);
      });
    }
    return found;
  }

  function buttonFor(stroke) {
    let node = stroke;
    for (let i = 0; i < 12 && node; i++) {
      const button = node.closest?.('button');
      if (button) return button;
      const root = node.getRootNode?.();
      if (!(root instanceof ShadowRoot)) break;
      node = root.host;
    }
    return null;
  }

  function findLikeAnchor() {
    const scope =
      document.querySelector('ytd-watch-metadata #actions') ||
      document.querySelector('ytd-watch-metadata #top-level-buttons-computed') ||
      document.querySelector('ytd-watch-metadata');
    if (!scope) return null;

    const strokes = deepQuery(scope, STROKE);
    let fallback = null;
    for (const stroke of strokes) {
      const button = buttonFor(stroke);
      if (!button) continue;
      const label = (button.getAttribute('aria-label') || '').toLowerCase();
      if (label.includes('dislike')) continue;
      const anchor = button.closest('like-button-view-model, ytd-toggle-button-renderer') || button;
      if (!fallback) fallback = anchor;
      if (label.includes('like') || button.closest('like-button-view-model')) return anchor;
    }
    return fallback;
  }

  function ensureOverlay() {
    const player = document.getElementById('movie_player');
    if (!player || document.getElementById(OVERLAY_ID)) return;
    const overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.textContent = 'Video hidden';
    player.appendChild(overlay);
  }

  function ensureButton() {
    if (location.pathname !== '/watch') {
      document.getElementById(BTN_ID)?.remove();
      return;
    }
    ensureOverlay();
    const anchor = findLikeAnchor();
    if (!anchor?.parentElement) return;

    let btn = document.getElementById(BTN_ID);
    if (btn?.nextElementSibling === anchor) {
      paint();
      return;
    }
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        localStorage.setItem(STORAGE_KEY, hidden() ? '0' : '1');
        paint();
      });
    }
    anchor.parentElement.insertBefore(btn, anchor);
    paint();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(ensureButton, 200);
  }

  paint();
  schedule();
  document.addEventListener('yt-navigate-finish', schedule);
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
