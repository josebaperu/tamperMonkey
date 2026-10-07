// ==UserScript==
// @name         YouTube Mobile Hide Playing Video
// @namespace    local.hide-yt-video-mobile
// @version      1.0.0
// @description  Hide or show the playing YouTube video on m.youtube.com from a toggle below the player
// @match        https://m.youtube.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const BTN_ID = 'ytm-hide-video-btn';
  const BAR_ID = 'ytm-hide-video-bar';
  const OVERLAY_ID = 'ytm-hide-video-overlay';
  const HIDDEN_CLASS = 'ytm-hide-playing-video';
  const STORAGE_KEY = 'yt-hide-playing-video';
  const ANCHOR_CLASS = 'modern-subscribe-button';

  const EYE = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75C21.27 7.61 17 4.5 12 4.5c-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/></svg>';

  const PLAYER_SELECTORS = [
    '#player-container-id',
    'ytm-player',
    '.player-container',
    '#player',
  ];

  const style = document.createElement('style');
  style.textContent = `
    html.${HIDDEN_CLASS} #movie_player .html5-video-container,
    html.${HIDDEN_CLASS} #movie_player video,
    html.${HIDDEN_CLASS} #movie_player .ytp-cued-thumbnail-overlay,
    html.${HIDDEN_CLASS} .player-container video,
    html.${HIDDEN_CLASS} .ytm-autonav-bar,
    html.${HIDDEN_CLASS} .ytp-ce-element,
    html.${HIDDEN_CLASS} .ytp-endscreen-content,
    html.${HIDDEN_CLASS} .ytp-videowall-still {
      opacity: 0 !important;
      visibility: hidden !important;
    }
    #${OVERLAY_ID} {
      display: none;
      position: absolute;
      inset: 0;
      z-index: 20;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      color: #aaa;
      font: 500 15px Roboto, Arial, sans-serif;
    }
    html.${HIDDEN_CLASS} #${OVERLAY_ID} { display: flex; }
    #${BAR_ID} {
      display: inline-flex;
      align-items: center;
      flex: 0 0 auto;
      margin-left: 8px;
    }
    #${BTN_ID} {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 36px;
      padding: 0 28px;
      white-space: nowrap;
      border: 0;
      border-radius: 18px;
      cursor: pointer;
      font: 500 14px Roboto, Arial, sans-serif !important;
      line-height: 36px !important;
      color: #fff !important;
      background: #3a3a3a !important;
      -webkit-tap-highlight-color: transparent;
    }
    #${BTN_ID}[aria-pressed="true"] {
      color: #0f0f0f !important;
      background: #f1f1f1 !important;
    }
    #${BTN_ID} svg { display: block; flex: 0 0 auto; }
    #${BTN_ID} span {
      display: inline !important;
      font-size: 14px !important;
      color: inherit !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
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
    btn.innerHTML = (on ? EYE : EYE_OFF) + '<span>' + (on ? 'Show video' : 'Hide video') + '</span>';
  }

  function findPlayerWrapper() {
    for (const sel of PLAYER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el && el.offsetHeight > 0) return el;
    }
    return document.getElementById('movie_player');
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
    if (location.pathname !== '/watch' && !location.pathname.startsWith('/shorts')) {
      document.getElementById(BAR_ID)?.remove();
      return;
    }
    ensureOverlay();
    const anchor = document.querySelector('.' + ANCHOR_CLASS);
    if (!anchor?.parentElement) return;

    let bar = document.getElementById(BAR_ID);
    if (bar && bar.previousElementSibling === anchor) {
      paint();
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = BAR_ID;
      const btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        localStorage.setItem(STORAGE_KEY, hidden() ? '0' : '1');
        paint();
      });
      bar.appendChild(btn);
    }
    anchor.parentElement.insertBefore(bar, anchor.nextSibling);
    paint();
  }

  let timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(ensureButton, 200);
  }

  paint();
  schedule();
  window.addEventListener('state-navigateend', schedule);
  window.addEventListener('popstate', schedule);
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
