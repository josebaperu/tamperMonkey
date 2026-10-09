// ==UserScript==
// @name         YouTube / YouTube Music
// @namespace    https://tampermonkey.net/
// @version      1.2.0
// @description  Block YouTube ads. On YouTube Music, show a black player square. Hide Shorts on the YouTube home page.
// @author       you
// @match        https://www.youtube.com/*
// @match        https://m.youtube.com/*
// @match        https://music.youtube.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=youtube.com
// @grant        none
// @run-at       document-idle

// ==/UserScript==

(function() {
  'use strict';
// YouTube ad blocking for this WebView.
//
// Implements the same two techniques uBlock Origin applies to YouTube, written
// from scratch (this is not uBO source):
//   1. "json-prune" - delete the ad payloads out of the player's JSON responses
//      so the player never schedules an ad in the first place.
//   2. cosmetic/DOM cleanup as a fallback for whatever still reaches the page.
//
// Injected at document start when the WebView supports it, and again on every
// onPageFinished; the guard below keeps the hooks from stacking up.

  if (!window.__ytAdBlock) {
    window.__ytAdBlock = true;

    // YouTube Music only: hide the video wrapper and paint the player square
    // black. Audio keeps playing. No toggle. www.youtube.com and m.youtube.com
    // are unchanged.
    if (location.hostname === 'music.youtube.com') {
      var ytmBlank = document.createElement('style');
      ytmBlank.textContent = [
        'ytmusic-player[video-mode],',
        'ytmusic-player[video-mode] #song-video {',
        '  background: #000 !important;',
        '  background-color: #000 !important;',
        '}',
        'ytmusic-player #song-video .player-wrapper,',
        'ytmusic-player #song-video .html5-video-container,',
        'ytmusic-player #song-video video,',
        'ytmusic-player #song-video .ytp-cued-thumbnail-overlay,',
        'ytmusic-player #song-video .ytp-ce-element,',
        'ytmusic-player #song-video .ytp-endscreen-content,',
        'ytmusic-player #song-video .ytp-upnext,',
        'ytmusic-player #song-video .ytp-videowall-still,',
        'ytmusic-player[video-mode] #song-image,',
        'ytmusic-player[video-mode] #song-image img {',
        '  opacity: 0 !important;',
        '  visibility: hidden !important;',
        '}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(ytmBlank);
    }

    // YouTube home only: hide Shorts shelves before the removal pass runs.
    if (location.hostname === 'www.youtube.com' || location.hostname === 'm.youtube.com') {
      var homeShortsStyle = document.createElement('style');
      homeShortsStyle.textContent = [
        'html.yt-no-home-shorts ytd-rich-shelf-renderer[is-shorts],',
        'html.yt-no-home-shorts ytd-rich-section-renderer:has(ytd-rich-shelf-renderer[is-shorts]),',
        'html.yt-no-home-shorts ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model),',
        'html.yt-no-home-shorts ytd-rich-item-renderer:has(ytm-shorts-lockup-view-model-v2),',
        'html.yt-no-home-shorts ytd-reel-shelf-renderer,',
        'html.yt-no-home-shorts ytd-shorts-shelf-renderer,',
        'html.yt-no-home-shorts ytm-reel-shelf-renderer,',
        'html.yt-no-home-shorts ytm-rich-section-renderer:has(ytm-reel-shelf-renderer),',
        'html.yt-no-home-shorts ytm-rich-section-renderer:has(ytm-shorts-lockup-view-model),',
        'html.yt-no-home-shorts ytm-rich-item-renderer:has(ytm-shorts-lockup-view-model),',
        'html.yt-no-home-shorts ytm-rich-item-renderer:has(ytm-shorts-lockup-view-model-v2) {',
        '  display: none !important;',
        '}'
      ].join('\n');
      (document.head || document.documentElement).appendChild(homeShortsStyle);
    }

    // Keys YouTube uses to carry ad breaks in the player/browse responses.
    var AD_KEYS = [
      'adPlacements',
      'playerAds',
      'adSlots',
      'adBreakHeartbeatParams',
      'adServiceInfo',
      'adParams'
    ];

    // Ads only ever live at the top level of a response or under playerResponse,
    // so prune those instead of walking the whole (very large) payload.
    function stripAds(data) {
      if (!data || typeof data !== 'object') {
        return data;
      }
      var scopes = [data, data.playerResponse, data.playerResponseJson];
      for (var i = 0; i < scopes.length; i++) {
        var scope = scopes[i];
        if (!scope || typeof scope !== 'object') {
          continue;
        }
        for (var j = 0; j < AD_KEYS.length; j++) {
          if (scope[AD_KEYS[j]] !== undefined) {
            try {
              delete scope[AD_KEYS[j]];
            } catch (e) {
            }
          }
        }
      }
      return data;
    }

    // --- 1. Network level -------------------------------------------------

    var nativeParse = JSON.parse;
    JSON.parse = function () {
      return stripAds(nativeParse.apply(JSON, arguments));
    };

    if (window.Response && window.Response.prototype && window.Response.prototype.json) {
      var nativeJson = window.Response.prototype.json;
      window.Response.prototype.json = function () {
        return nativeJson.apply(this, arguments).then(stripAds);
      };
    }

    // The first video's data is inlined in the HTML rather than fetched. If we
    // got in early, trap the assignment; if the page already ran, prune in place.
    if (window.ytInitialPlayerResponse) {
      stripAds(window.ytInitialPlayerResponse);
    } else {
      var initialResponse;
      try {
        Object.defineProperty(window, 'ytInitialPlayerResponse', {
          configurable: true,
          get: function () {
            return initialResponse;
          },
          set: function (value) {
            initialResponse = stripAds(value);
          }
        });
      } catch (e) {
      }
    }
    if (window.ytInitialData) {
      stripAds(window.ytInitialData);
    }

    // --- 2. DOM level -----------------------------------------------------

    var SKIP_BUTTONS = '.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button';
    var AD_PLAYING = '.ad-showing, .ytp-ad-player-overlay, .ytp-ad-player-overlay-layout';
    var AD_SLOTS = '.ytp-ad-overlay-slot, .ytp-ad-overlay-container, ytd-ad-slot-renderer, ytm-companion-slot-renderer, ytd-companion-slot-renderer, ytd-in-feed-ad-layout-renderer';

    function clearAds() {
      var skips = document.querySelectorAll(SKIP_BUTTONS);
      for (var i = 0; i < skips.length; i++) {
        skips[i].click();
      }

      // An unskippable ad is still playing: run it to its end rather than watch it.
      if (document.querySelector(AD_PLAYING)) {
        var video = document.querySelector('video');
        if (video && video.duration && isFinite(video.duration)) {
          video.currentTime = video.duration;
        }
      }

      var slots = document.querySelectorAll(AD_SLOTS);
      for (var k = 0; k < slots.length; k++) {
        slots[k].remove();
      }

      // Autoplay starts muted when the page thinks it lacks a gesture.
      var unmute = document.querySelector('button.ytp-unmute');
      if (unmute && unmute.offsetParent !== null) {
        unmute.click();
      }

      // Dismiss the "Video paused. Continue watching?" interstitial.
      var confirmWatching = document.querySelector("button[aria-label='Yes']");
      if (confirmWatching) {
        confirmWatching.click();
      }
    }

    function isYouTubeHome() {
      return (location.hostname === 'www.youtube.com' || location.hostname === 'm.youtube.com') &&
        (location.pathname === '/' || location.pathname === '');
    }

    function removeEl(node) {
      if (node && node.parentNode) {
        node.remove();
      }
    }

    // Shorts stay available on /shorts, search, watch, and channel pages.
    // Only the home landing feed loses its Shorts shelves and Shorts items.
    function hideHomeShorts() {
      var home = isYouTubeHome();
      document.documentElement.classList.toggle('yt-no-home-shorts', home);
      if (!home) {
        return;
      }

      var root = document.querySelector('ytd-browse[page-subtype="home"]');
      if (!root && location.hostname === 'www.youtube.com') {
        root = document.querySelector('ytd-browse');
      }
      if (!root && location.hostname === 'm.youtube.com') {
        root = document.querySelector('ytm-browse') || document.querySelector('ytm-app');
      }
      if (!root) {
        return;
      }

      var shelves = root.querySelectorAll(
        'ytd-rich-shelf-renderer[is-shorts], ytd-reel-shelf-renderer, ytd-shorts-shelf-renderer, ytm-reel-shelf-renderer'
      );
      for (var i = 0; i < shelves.length; i++) {
        removeEl(shelves[i].closest('ytd-rich-section-renderer, ytm-rich-section-renderer, ytd-item-section-renderer') || shelves[i]);
      }

      var lockups = root.querySelectorAll(
        'ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2, ytd-reel-item-renderer'
      );
      for (var j = 0; j < lockups.length; j++) {
        removeEl(lockups[j].closest('ytd-rich-item-renderer, ytm-rich-item-renderer, ytd-rich-section-renderer, ytm-rich-section-renderer') || lockups[j]);
      }

      if (location.hostname === 'www.youtube.com') {
        var links = root.querySelectorAll('a[href^="/shorts/"]');
        for (var n = 0; n < links.length; n++) {
          removeEl(links[n].closest('ytd-rich-item-renderer, ytd-rich-section-renderer, ytd-reel-item-renderer'));
        }
        var badges = root.querySelectorAll('ytd-thumbnail-overlay-time-status-renderer[overlay-style="SHORTS"]');
        for (var b = 0; b < badges.length; b++) {
          removeEl(badges[b].closest('ytd-rich-item-renderer, ytd-rich-section-renderer, ytd-grid-video-renderer'));
        }
      }
    }

    // YouTube mutates constantly, so coalesce bursts instead of running per mutation.
    var queued = false;
    function schedule() {
      if (queued) {
        return;
      }
      queued = true;
      setTimeout(function () {
        queued = false;
        try {
          clearAds();
          hideHomeShorts();
        } catch (e) {
        }
      }, 50);
    }

    function start() {
      schedule();
      new MutationObserver(schedule).observe(document.documentElement || document, {
        subtree: true,
        childList: true
      });
      // Safety net: some ad states appear without a DOM mutation near the player.
      setInterval(schedule, 1000);
      document.addEventListener('yt-navigate-finish', schedule);
      window.addEventListener('state-navigateend', schedule);
    }

    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start);
    }
  }
})();