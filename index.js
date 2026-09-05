// Bluetooth Audio Fix — pre-compiled for Kettu/Vendetta/Bunny/Revenge
// No import/export — runs directly in Hermes without a bundler step.
(function (RN, instead) {
  "use strict";

  // ── Resolve native audio module ──────────────────────────────────────────
  var AudioManager =
    RN.TurboModuleRegistry.get("RTNAudioManager") ||
    RN.TurboModuleRegistry.get("NativeAudioManagerModule") ||
    null;

  var patches = [];
  var keepAliveTimer = null;
  var callStateUnsubs = [];

  // ── Helpers ──────────────────────────────────────────────────────────────
  function safeInstead(method, fn) {
    if (!AudioManager || typeof AudioManager[method] !== "function") return null;
    try { return instead(method, AudioManager, fn); } catch (e) { return null; }
  }

  // ── Patch 1: Block setCommunicationModeOn(true) ──────────────────────────
  // true  → blocked  (keeps Bluetooth in A2DP, phone mic stays as input)
  // false → allowed  (clears routing when switching to Phone/Speaker)
  patches.push(safeInstead("setCommunicationModeOn", function (args, orig) {
    if (args[0]) return;
    return orig.apply(this, args);
  }));

  // ── Patch 2: Block sibling SCO methods (Samsung OneUI / MIUI) ────────────
  // setBluetoothScoOn: block enable, allow disable
  patches.push(safeInstead("setBluetoothScoOn", function (args, orig) {
    if (args[0] === true) return;
    return orig.apply(this, args);
  }));

  // startBluetoothSco: always block (opens SCO unconditionally)
  patches.push(safeInstead("startBluetoothSco", function () {}));

  // setMode: block IN_CALL (2) and IN_COMMUNICATION (3)
  patches.push(safeInstead("setMode", function (args, orig) {
    if (args[0] === 2 || args[0] === 3) return;
    return orig.apply(this, args);
  }));

  // setCommunicationDevice (Android 12+): block only TYPE_BLUETOOTH_SCO (8)
  patches.push(safeInstead("setCommunicationDevice", function (args, orig) {
    var dev = args[0] || {};
    if ((dev.type || dev.deviceType || -1) === 8) return;
    return orig.apply(this, args);
  }));

  // Catch-all: any other OEM-specific SCO method names
  if (AudioManager) {
    var skip = ["setCommunicationModeOn", "setCommunicationDevice",
                "setBluetoothScoOn", "startBluetoothSco"];
    var keys = Object.keys(AudioManager);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (skip.indexOf(k) !== -1) continue;
      if (typeof AudioManager[k] !== "function") continue;
      if (!/sco|startBluetooth|communication.*device/i.test(k)) continue;
      patches.push(safeInstead(k, function (args, orig) {
        if (args[0] === true) return;
        if (typeof args[0] === "number" && args[0] >= 2) return;
        return orig.apply(this, args);
      }));
    }
  }

  // ── Patch 3: Samsung/MIUI keep-alive ─────────────────────────────────────
  // HAL can re-enable SCO silently — we push back every 3s during a call.
  function startKeepAlive() {
    if (keepAliveTimer) return;
    keepAliveTimer = setInterval(function () {
      try { AudioManager && AudioManager.setCommunicationModeOn && AudioManager.setCommunicationModeOn(false); } catch (e) {}
      try { AudioManager && AudioManager.stopBluetoothSco && AudioManager.stopBluetoothSco(); } catch (e) {}
      try { AudioManager && AudioManager.setBluetoothScoOn && AudioManager.setBluetoothScoOn(false); } catch (e) {}
      try { AudioManager && AudioManager.setMode && AudioManager.setMode(0); } catch (e) {}
    }, 3000);
  }
  function stopKeepAlive() {
    if (!keepAliveTimer) return;
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }

  function onCallEvent(event) {
    if (!event) return;
    var t = event.type;
    if (t === "VOICE_CHANNEL_SELECT") {
      if (event.channelId == null) stopKeepAlive(); else startKeepAlive();
    } else if (t === "RTC_CONNECTION_STATE") {
      if (event.state === "connected" || event.state === "RTC_CONNECTED") startKeepAlive();
      else if (event.state === "disconnected" || event.state === "RTC_DISCONNECTED") stopKeepAlive();
    } else if (t === "VOICE_CONNECTION_OPEN") {
      startKeepAlive();
    } else if (t === "VOICE_CONNECTION_CLOSE") {
      stopKeepAlive();
    }
  }

  // ── Patch 4: UI selected-device fix ──────────────────────────────────────
  // Force the audio store to re-render after device switches.
  function forceUIRefresh() {
    var api =
      (typeof vendetta !== "undefined" && vendetta) ||
      (typeof bunny    !== "undefined" && bunny)    ||
      (typeof revenge  !== "undefined" && revenge)  ||
      null;

    var findByProps = api && api.metro && api.metro.findByProps || null;
    var FluxDispatcher = api && api.metro && api.metro.common &&
      (api.metro.common.FluxDispatcher || api.metro.common.Dispatcher) || null;

    if (findByProps) {
      var store =
        findByProps("getOutputVolume", "getAudioDevice") ||
        findByProps("getOutputVolume", "getCommunicationAudioDevice") ||
        findByProps("getCurrentSpeakerDevice") ||
        findByProps("getAudioDevice") || null;
      try { store && store.emitChange && store.emitChange(); } catch (e) {}
    }

    if (FluxDispatcher) {
      var evts = [
        "MEDIA_ENGINE_SET_OUTPUT_VOLUME", "AUDIO_DEVICE_CHANGED",
        "VOICE_SETTINGS_UPDATE", "AUDIO_OUTPUT_DEVICE_CHANGED",
        "MEDIA_ENGINE_AUDIO_DEVICE_CHANGED"
      ];
      for (var i = 0; i < evts.length; i++) {
        try { FluxDispatcher.dispatch({ type: evts[i] }); } catch (e) {}
      }

      // Subscribe keep-alive to call events (only once, when FluxDispatcher available)
      var callEvts = ["VOICE_CONNECTION_OPEN", "VOICE_CONNECTION_CLOSE",
                      "RTC_CONNECTION_STATE", "VOICE_CHANNEL_SELECT"];
      for (var j = 0; j < callEvts.length; j++) {
        try {
          var unsub = FluxDispatcher.subscribe(callEvts[j], onCallEvent);
          if (unsub) callStateUnsubs.push(unsub);
        } catch (e) {}
      }
    }
  }

  // Run UI setup once after Discord has finished loading
  setTimeout(forceUIRefresh, 1000);

  // Also patch native device-routing methods for UI refresh
  if (AudioManager) {
    var audioKeys = Object.keys(AudioManager);
    for (var n = 0; n < audioKeys.length; n++) {
      var ak = audioKeys[n];
      if (ak === "setCommunicationModeOn") continue;
      if (typeof AudioManager[ak] !== "function") continue;
      if (!/device|output|route/i.test(ak)) continue;
      (function (method) {
        patches.push(safeInstead(method, function (args, orig) {
          var result = orig.apply(this, args);
          setTimeout(forceUIRefresh, 50);
          return result;
        }));
      })(ak);
    }
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  module.exports.onUnload = function () {
    for (var i = 0; i < patches.length; i++) {
      try { patches[i] && patches[i](); } catch (e) {}
    }
    stopKeepAlive();
    for (var j = 0; j < callStateUnsubs.length; j++) {
      try { callStateUnsubs[j] && callStateUnsubs[j](); } catch (e) {}
    }
  };

}(
  require("@vendetta/metro/common").ReactNative,
  require("@vendetta/patcher").instead
));