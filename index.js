import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

// ─── Audio module ────────────────────────────────────────────────────────────
var AudioManager =
  RN.TurboModuleRegistry.get("RTNAudioManager") ||
  RN.TurboModuleRegistry.get("NativeAudioManagerModule") ||
  null;

var patches = [];
var keepAliveTimer = null;
var callStateUnsubs = [];

// ─── Safe patch helper ────────────────────────────────────────────────────────
// NOTE: always catch(e) — bare catch{} is ES2019 and breaks older Hermes builds
function safeInstead(method, fn) {
  if (!AudioManager || typeof AudioManager[method] !== "function") return null;
  try { return instead(method, AudioManager, fn); } catch(e) { return null; }
}

// ─── Patch 1: setCommunicationModeOn ─────────────────────────────────────────
// true  → blocked  (keeps Bluetooth in A2DP, phone mic stays active)
// false → allowed  (resets routing when switching to Phone/Speaker)
patches.push(safeInstead("setCommunicationModeOn", function(args, orig) {
  if (args[0]) return;
  return orig.apply(this, args);
}));

// ─── Patch 2: Samsung OneUI / MIUI / HyperOS sibling SCO methods ─────────────
patches.push(safeInstead("setBluetoothScoOn", function(args, orig) {
  if (args[0] === true) return;
  return orig.apply(this, args);
}));

patches.push(safeInstead("startBluetoothSco", function() {}));

patches.push(safeInstead("setMode", function(args, orig) {
  if (args[0] === 2 || args[0] === 3) return;
  return orig.apply(this, args);
}));

patches.push(safeInstead("setCommunicationDevice", function(args, orig) {
  var dev = args[0] || {};
  if ((dev.type || dev.deviceType || -1) === 8) return;
  return orig.apply(this, args);
}));

// Catch-all for any other OEM-named SCO methods
if (AudioManager) {
  var skipList = [
    "setCommunicationModeOn", "setCommunicationDevice",
    "setBluetoothScoOn", "startBluetoothSco"
  ];
  var allKeys = Object.keys(AudioManager);
  for (var i = 0; i < allKeys.length; i++) {
    var k = allKeys[i];
    if (skipList.indexOf(k) !== -1) continue;
    if (typeof AudioManager[k] !== "function") continue;
    if (!/sco|startBluetooth|communication.*device/i.test(k)) continue;
    patches.push(safeInstead(k, function(args, orig) {
      if (args[0] === true) return;
      if (typeof args[0] === "number" && args[0] >= 2) return;
      return orig.apply(this, args);
    }));
  }
}

// ─── Patch 3: HyperOS/Samsung keep-alive ─────────────────────────────────────
// HAL can silently re-enable SCO a few seconds into a call.
// We push back every 3 seconds while in a voice call.
function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(function() {
    try { AudioManager && AudioManager.setCommunicationModeOn && AudioManager.setCommunicationModeOn(false); } catch(e) {}
    try { AudioManager && AudioManager.stopBluetoothSco && AudioManager.stopBluetoothSco(); } catch(e) {}
    try { AudioManager && AudioManager.setBluetoothScoOn && AudioManager.setBluetoothScoOn(false); } catch(e) {}
    try { AudioManager && AudioManager.setMode && AudioManager.setMode(0); } catch(e) {}
  }, 3000);
}

function stopKeepAlive() {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

// ─── Patch 4: UI selected-device fix ─────────────────────────────────────────
// Resolved lazily so globals are available by the time a device is switched.
function forceUIRefresh() {
  var api =
    (typeof vendetta !== "undefined" && vendetta) ||
    (typeof bunny    !== "undefined" && bunny)    ||
    (typeof revenge  !== "undefined" && revenge)  ||
    null;
  if (!api) return;

  var metro  = api.metro  || {};
  var common = metro.common || {};
  var FluxDispatcher = common.FluxDispatcher || common.Dispatcher || null;
  var findByProps    = metro.findByProps || null;

  if (findByProps) {
    var store =
      findByProps("getOutputVolume", "getAudioDevice") ||
      findByProps("getOutputVolume", "getCommunicationAudioDevice") ||
      findByProps("getCurrentSpeakerDevice") ||
      findByProps("getAudioDevice") || null;
    try { store && store.emitChange && store.emitChange(); } catch(e) {}
  }

  if (FluxDispatcher) {
    var uiTypes = [
      "MEDIA_ENGINE_SET_OUTPUT_VOLUME", "AUDIO_DEVICE_CHANGED",
      "VOICE_SETTINGS_UPDATE", "AUDIO_OUTPUT_DEVICE_CHANGED",
      "MEDIA_ENGINE_AUDIO_DEVICE_CHANGED"
    ];
    for (var i = 0; i < uiTypes.length; i++) {
      try { FluxDispatcher.dispatch({ type: uiTypes[i] }); } catch(e) {}
    }
  }
}

// Subscribe to call events for keep-alive — done lazily after load
setTimeout(function() {
  var api =
    (typeof vendetta !== "undefined" && vendetta) ||
    (typeof bunny    !== "undefined" && bunny)    ||
    (typeof revenge  !== "undefined" && revenge)  ||
    null;
  if (!api) return;

  var FluxDispatcher =
    (api.metro && api.metro.common &&
      (api.metro.common.FluxDispatcher || api.metro.common.Dispatcher)) || null;
  if (!FluxDispatcher) return;

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

  var callEvts = [
    "VOICE_CONNECTION_OPEN", "VOICE_CONNECTION_CLOSE",
    "RTC_CONNECTION_STATE",  "VOICE_CHANNEL_SELECT"
  ];
  for (var j = 0; j < callEvts.length; j++) {
    try {
      var unsub = FluxDispatcher.subscribe(callEvts[j], onCallEvent);
      if (unsub) callStateUnsubs.push(unsub);
    } catch(e) {}
  }

  // Also hook native device-routing methods for UI refresh
  if (AudioManager) {
    var routeKeys = Object.keys(AudioManager);
    for (var n = 0; n < routeKeys.length; n++) {
      var rk = routeKeys[n];
      if (rk === "setCommunicationModeOn") continue;
      if (typeof AudioManager[rk] !== "function") continue;
      if (!/device|output|route/i.test(rk)) continue;
      try {
        patches.push(instead(rk, AudioManager, function(args, orig) {
          var res = orig.apply(this, args);
          setTimeout(forceUIRefresh, 50);
          return res;
        }));
      } catch(e) {}
    }
  }
}, 500);

// ─── Cleanup ──────────────────────────────────────────────────────────────────
export const onUnload = function() {
  for (var i = 0; i < patches.length; i++) {
    try { patches[i] && patches[i](); } catch(e) {}
  }
  stopKeepAlive();
  for (var j = 0; j < callStateUnsubs.length; j++) {
    try { callStateUnsubs[j] && callStateUnsubs[j](); } catch(e) {}
  }
};