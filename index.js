import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

// ─────────────────────────────────────────────────────────────────────────────
// POLYFILLS
// We keep strictly the same two imports as the original working plugin.
// Everything else is resolved at runtime through the global mod API.
// ─────────────────────────────────────────────────────────────────────────────

// 'after' — implemented via 'instead' so we don't need to import it.
function makeAfter(obj, method, cb) {
  if (!obj || typeof obj[method] !== "function") return null;
  return instead(method, obj, function(args, orig) {
    var result = orig.apply(this, args);
    try { cb(args, result); } catch(e) {}
    return result;
  });
}

// 'findByProps' and 'FluxDispatcher' — read from the global mod object.
// Kettu/Bunny/Revenge/Vendetta all expose their API on a global.
// typeof-guard is safe: it never throws for undeclared variables.
var _api =
  (typeof vendetta !== "undefined" && vendetta) ||
  (typeof bunny    !== "undefined" && bunny)    ||
  (typeof revenge  !== "undefined" && revenge)  ||
  null;

var _metro   = (_api && _api.metro)  || {};
var _common  = (_metro.common)       || {};

var FluxDispatcher = _common.FluxDispatcher || _common.Dispatcher || null;

function findByProps() {
  var fn = _metro.findByProps || null;
  if (!fn) return null;
  try { return fn.apply(null, arguments); } catch(e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
var patches       = [];
var keepAliveTimer  = null;
var callStateUnsubs = [];

// ─────────────────────────────────────────────────────────────────────────────
// NATIVE AUDIO MODULE
// ─────────────────────────────────────────────────────────────────────────────
var AudioManager =
  RN.TurboModuleRegistry.get("RTNAudioManager") ||
  RN.TurboModuleRegistry.get("NativeAudioManagerModule") ||
  null;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — safe patch wrapper (always use catch(e) for Hermes compat)
// ─────────────────────────────────────────────────────────────────────────────
function safeInstead(obj, method, fn) {
  if (!obj || typeof obj[method] !== "function") return null;
  try { return instead(method, obj, fn); } catch(e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 1 — Block setCommunicationModeOn(true)
//
// Stops Discord from switching Android into MODE_IN_COMMUNICATION,
// which forces Bluetooth from A2DP (high quality) to SCO/HFP (mono).
//   true  → blocked  (A2DP stays alive, phone mic stays as input)
//   false → allowed  (clears routing when switching to Phone/Speaker)
// ─────────────────────────────────────────────────────────────────────────────
patches.push(
  safeInstead(AudioManager, "setCommunicationModeOn", function(args, orig) {
    if (args[0]) return;
    return orig.apply(this, args);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 2 — Block sibling SCO methods (Samsung OneUI & MIUI)
//
// These OEMs call extra AudioManager methods independently of
// setCommunicationModeOn to open an SCO session:
//
//  setBluetoothScoOn(bool)  — directly enables the SCO link
//  startBluetoothSco()      — legacy API, still used by some OEM audio HALs
//  setMode(int)             — mode 2=IN_CALL, 3=IN_COMMUNICATION → block both
//  setCommunicationDevice   — Android 12+ API: block if device type = SCO (8)
// ─────────────────────────────────────────────────────────────────────────────
if (AudioManager) {

  patches.push(
    safeInstead(AudioManager, "setBluetoothScoOn", function(args, orig) {
      if (args[0] === true) return;
      return orig.apply(this, args);
    })
  );

  patches.push(
    safeInstead(AudioManager, "startBluetoothSco", function() {})
  );

  patches.push(
    safeInstead(AudioManager, "setMode", function(args, orig) {
      if (args[0] === 2 || args[0] === 3) return;
      return orig.apply(this, args);
    })
  );

  patches.push(
    safeInstead(AudioManager, "setCommunicationDevice", function(args, orig) {
      var device = args[0] || {};
      var deviceType = device.type || device.deviceType || -1;
      if (deviceType === 8) return; // TYPE_BLUETOOTH_SCO
      return orig.apply(this, args);
    })
  );

  // Catch-all: block any other OEM-specific method whose name suggests SCO.
  var alreadyPatched = [
    "setCommunicationModeOn", "setCommunicationDevice",
    "setBluetoothScoOn", "startBluetoothSco"
  ];
  var keys = Object.keys(AudioManager);
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    if (alreadyPatched.indexOf(k) !== -1) continue;
    if (typeof AudioManager[k] !== "function") continue;
    if (!/sco|startBluetooth|communication.*device/i.test(k)) continue;
    patches.push(
      safeInstead(AudioManager, k, function(args, orig) {
        if (args[0] === true) return;
        if (typeof args[0] === "number" && args[0] >= 2) return;
        return orig.apply(this, args);
      })
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 3 — Samsung/MIUI keep-alive
//
// Samsung/MIUI audio HAL can re-enable SCO seconds after call start,
// bypassing JS patches. We periodically push back with disable calls.
// Only runs during an active voice call.
// ─────────────────────────────────────────────────────────────────────────────
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

function onCallEvent(event) {
  if (!event) return;
  if (event.type === "VOICE_CHANNEL_SELECT") {
    if (event.channelId == null) { stopKeepAlive(); }
    else { startKeepAlive(); }
    return;
  }
  if (event.type === "RTC_CONNECTION_STATE") {
    if (event.state === "connected" || event.state === "RTC_CONNECTED") { startKeepAlive(); }
    else if (event.state === "disconnected" || event.state === "RTC_DISCONNECTED") { stopKeepAlive(); }
    return;
  }
  if (event.type === "VOICE_CONNECTION_OPEN") { startKeepAlive(); }
  if (event.type === "VOICE_CONNECTION_CLOSE") { stopKeepAlive(); }
}

if (FluxDispatcher) {
  var callEvents = [
    "VOICE_CONNECTION_OPEN", "VOICE_CONNECTION_CLOSE",
    "RTC_CONNECTION_STATE",  "VOICE_CHANNEL_SELECT"
  ];
  for (var j = 0; j < callEvents.length; j++) {
    try {
      var unsub = FluxDispatcher.subscribe(callEvents[j], onCallEvent);
      if (unsub) callStateUnsubs.push(unsub);
    } catch(e) {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 4 — UI selected-device display fix
//
// After any device switch, force the MediaEngineStore to emit a change
// so Discord's picker re-renders with the correct checkmark.
// ─────────────────────────────────────────────────────────────────────────────
var MediaEngineStore =
  findByProps("getOutputVolume", "getAudioDevice") ||
  findByProps("getOutputVolume", "getCommunicationAudioDevice") ||
  findByProps("getMediaEngine", "isDeaf") ||
  findByProps("getCurrentSpeakerDevice") ||
  findByProps("getAudioDevice") ||
  null;

function forceUIRefresh() {
  try { MediaEngineStore && MediaEngineStore.emitChange && MediaEngineStore.emitChange(); } catch(e) {}
  if (!FluxDispatcher) return;
  var uiEvents = [
    "MEDIA_ENGINE_SET_OUTPUT_VOLUME",
    "AUDIO_DEVICE_CHANGED",
    "VOICE_SETTINGS_UPDATE",
    "AUDIO_OUTPUT_DEVICE_CHANGED",
    "MEDIA_ENGINE_AUDIO_DEVICE_CHANGED"
  ];
  for (var i = 0; i < uiEvents.length; i++) {
    try { FluxDispatcher.dispatch({ type: uiEvents[i] }); } catch(e) {}
  }
}

// Patch JS-side device-selection actions
var DeviceActions =
  findByProps("setAudioDevice", "getAudioInputDevices") ||
  findByProps("selectAudioOutputDevice", "selectAudioInputDevice") ||
  findByProps("setAudioDevice") ||
  findByProps("selectAudioDevice") ||
  findByProps("setAudioOutputDevice") ||
  null;

if (DeviceActions) {
  var uiMethodNames = ["setAudioDevice", "selectAudioOutputDevice", "selectAudioDevice", "setAudioOutputDevice"];
  var uiMethod = null;
  for (var m = 0; m < uiMethodNames.length; m++) {
    if (typeof DeviceActions[uiMethodNames[m]] === "function") {
      uiMethod = uiMethodNames[m];
      break;
    }
  }
  if (uiMethod) {
    patches.push(
      makeAfter(DeviceActions, uiMethod, function() { setTimeout(forceUIRefresh, 50); })
    );
  }
}

// Patch native-side device routing methods as fallback
if (AudioManager) {
  var audioKeys = Object.keys(AudioManager);
  for (var n = 0; n < audioKeys.length; n++) {
    var ak = audioKeys[n];
    if (ak === "setCommunicationModeOn") continue;
    if (typeof AudioManager[ak] !== "function") continue;
    if (!/device|output|route/i.test(ak)) continue;
    patches.push(
      makeAfter(AudioManager, ak, function() { setTimeout(forceUIRefresh, 50); })
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP
// ─────────────────────────────────────────────────────────────────────────────
export const onUnload = function() {
  for (var i = 0; i < patches.length; i++) {
    try { patches[i] && patches[i](); } catch(e) {}
  }
  stopKeepAlive();
  for (var j = 0; j < callStateUnsubs.length; j++) {
    try { callStateUnsubs[j] && callStateUnsubs[j](); } catch(e) {}
  }
};