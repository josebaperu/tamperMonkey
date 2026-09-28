// ==UserScript==
// @name         YouTube / YouTube Music
// @namespace    https://tampermonkey.net/
// @version      1.0.0
// @description  Runs on YouTube and YouTube Music
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
    }

    if (document.documentElement) {
      start();
    } else {
      document.addEventListener('DOMContentLoaded', start);
    }
  }
})();