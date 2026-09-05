import { ReactNative as RN, FluxDispatcher } from "@vendetta/metro/common";
import { instead, after } from "@vendetta/patcher";

// ─────────────────────────────────────────────────────────────────────────────
// findByProps — accessed through the global API at runtime.
// Kettu/Bunny/Revenge all expose this on their global object.
// We try every known global name so the plugin works regardless of mod version.
// ─────────────────────────────────────────────────────────────────────────────
function findByProps(...props) {
  var api =
    globalThis.vendetta   ||
    globalThis.bunny      ||
    globalThis.revenge    ||
    globalThis.enmity     ||
    {};
  var fn =
    (api.metro && api.metro.findByProps) ||
    (api.metro && api.metro.find)        ||
    null;
  if (!fn) return null;
  try { return fn(...props); } catch { return null; }
}

const patches = [];
let keepAliveTimer = null;
let inCall = false;

// ─────────────────────────────────────────────────────────────────────────────
// NATIVE AUDIO MODULE
// Discord uses different module names across RN versions — try both.
// ─────────────────────────────────────────────────────────────────────────────
const AudioManager =
  RN.TurboModuleRegistry.get("RTNAudioManager") ||
  RN.TurboModuleRegistry.get("NativeAudioManagerModule") ||
  null;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: safely patch a method only if it exists
// ─────────────────────────────────────────────────────────────────────────────
function safeInstead(obj, method, fn) {
  if (!obj || typeof obj[method] !== "function") return null;
  try { return instead(method, obj, fn); } catch (e) { return null; }
}
function safeAfter(obj, method, fn) {
  if (!obj || typeof obj[method] !== "function") return null;
  try { return after(method, obj, fn); } catch (e) { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 1 — Block setCommunicationModeOn(true)
//
// Prevents Discord from putting Android into MODE_IN_COMMUNICATION,
// which triggers Bluetooth to switch from A2DP (high quality) → SCO/HFP.
//   true  → blocked  (keeps A2DP alive, phone mic stays as input)
//   false → allowed  (resets routing when user switches to Phone/Speaker)
// ─────────────────────────────────────────────────────────────────────────────
patches.push(
  safeInstead(AudioManager, "setCommunicationModeOn", function(args, orig) {
    if (args[0]) return;
    return orig.apply(this, args);
  })
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 2 — Block sibling SCO/communication methods (Samsung & MIUI)
//
// Samsung OneUI and MIUI trigger SCO through these methods independently.
//  setBluetoothScoOn(bool)  — directly toggles SCO on the BT link
//  startBluetoothSco()      — opens an SCO session (legacy, still called by some OEMs)
//  setMode(int)             — AudioManager mode: block 2=IN_CALL, 3=IN_COMMUNICATION
//  setCommunicationDevice   — Android 12+ API: block only TYPE_BLUETOOTH_SCO (type 8)
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

  // ── Catch-all for any other OEM-specific SCO method names ─────────────────
  var alreadyPatched = [
    "setCommunicationModeOn", "setCommunicationDevice",
    "setBluetoothScoOn", "startBluetoothSco"
  ];
  Object.keys(AudioManager).forEach(function(k) {
    if (alreadyPatched.indexOf(k) !== -1) return;
    if (typeof AudioManager[k] !== "function") return;
    if (!/sco|startBluetooth|communication.*device/i.test(k)) return;
    patches.push(
      safeInstead(AudioManager, k, function(args, orig) {
        if (args[0] === true) return;
        if (typeof args[0] === "number" && args[0] >= 2) return;
        return orig.apply(this, args);
      })
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 3 — Samsung/MIUI keep-alive
//
// Samsung/MIUI audio HAL can silently re-enable SCO seconds after a call
// starts, bypassing all JS patches. We periodically push back by calling
// the disable path of every SCO method we patched. Only runs during a call.
// ─────────────────────────────────────────────────────────────────────────────
function startKeepAlive() {
  if (keepAliveTimer) return;
  keepAliveTimer = setInterval(function() {
    try { AudioManager && AudioManager.setCommunicationModeOn && AudioManager.setCommunicationModeOn(false); } catch(e) {}
    try { AudioManager && AudioManager.stopBluetoothSco && AudioManager.stopBluetoothSco(); } catch(e) {}
    try { AudioManager && AudioManager.setBluetoothScoOn && AudioManager.setBluetoothScoOn(false); } catch(e) {}
    try { AudioManager && AudioManager.setMode && AudioManager.setMode(0); } catch(e) {} // MODE_NORMAL
  }, 3000);
}

function stopKeepAlive() {
  if (!keepAliveTimer) return;
  clearInterval(keepAliveTimer);
  keepAliveTimer = null;
}

// Track voice call state via Flux events to start/stop the keep-alive.
var callStateUnsubs = [];

function onCallEvent(event) {
  if (!event) return;
  if (event.type === "VOICE_CHANNEL_SELECT") {
    if (event.channelId == null) { inCall = false; stopKeepAlive(); }
    else { inCall = true; startKeepAlive(); }
    return;
  }
  if (event.type === "RTC_CONNECTION_STATE") {
    if (event.state === "connected" || event.state === "RTC_CONNECTED") {
      inCall = true; startKeepAlive();
    } else if (event.state === "disconnected" || event.state === "RTC_DISCONNECTED") {
      inCall = false; stopKeepAlive();
    }
    return;
  }
  var startEvents = ["VOICE_CONNECTION_OPEN", "VOICE_STATE_UPDATES"];
  var endEvents   = ["VOICE_CONNECTION_CLOSE"];
  if (startEvents.indexOf(event.type) !== -1) { inCall = true;  startKeepAlive(); }
  if (endEvents.indexOf(event.type)   !== -1) { inCall = false; stopKeepAlive();  }
}

var allCallEvents = [
  "VOICE_CONNECTION_OPEN", "VOICE_CONNECTION_CLOSE",
  "RTC_CONNECTION_STATE",  "VOICE_CHANNEL_SELECT",
  "VOICE_STATE_UPDATES"
];
allCallEvents.forEach(function(evt) {
  try {
    var unsub = FluxDispatcher.subscribe(evt, onCallEvent);
    if (unsub) callStateUnsubs.push(unsub);
  } catch(e) {}
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH 4 — UI selected-device display fix
//
// After any device switch, force the MediaEngineStore to emit a change
// so Discord's picker re-renders with the correct selected checkmark.
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
  var types = [
    "MEDIA_ENGINE_SET_OUTPUT_VOLUME",
    "AUDIO_DEVICE_CHANGED",
    "VOICE_SETTINGS_UPDATE",
    "AUDIO_OUTPUT_DEVICE_CHANGED",
    "MEDIA_ENGINE_AUDIO_DEVICE_CHANGED"
  ];
  types.forEach(function(type) {
    try { FluxDispatcher.dispatch({ type: type }); } catch(e) {}
  });
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
  var deviceMethodNames = ["setAudioDevice", "selectAudioOutputDevice", "selectAudioDevice", "setAudioOutputDevice"];
  var foundMethod = null;
  for (var i = 0; i < deviceMethodNames.length; i++) {
    if (typeof DeviceActions[deviceMethodNames[i]] === "function") {
      foundMethod = deviceMethodNames[i];
      break;
    }
  }
  if (foundMethod) {
    patches.push(
      safeAfter(DeviceActions, foundMethod, function() {
        setTimeout(forceUIRefresh, 50);
      })
    );
  }
}

// Patch native-side device routing methods as a fallback
if (AudioManager) {
  Object.keys(AudioManager).forEach(function(k) {
    if (k === "setCommunicationModeOn") return;
    if (typeof AudioManager[k] !== "function") return;
    if (!/device|output|route/i.test(k)) return;
    patches.push(
      safeAfter(AudioManager, k, function() {
        setTimeout(forceUIRefresh, 50);
      })
    );
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEANUP — remove all patches and timers when the plugin is disabled
// ─────────────────────────────────────────────────────────────────────────────
export const onUnload = function() {
  patches.forEach(function(p) { try { p && p(); } catch(e) {} });
  stopKeepAlive();
  callStateUnsubs.forEach(function(unsub) { try { unsub && unsub(); } catch(e) {} });
};