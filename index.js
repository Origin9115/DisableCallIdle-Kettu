import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

// ─── Debug helper — uses Alert dialog (impossible to miss) + console.log ──────
function debug(msg) {
  try { console.log("[BT-FIX] " + msg); } catch(e) {}
  try { RN.Alert.alert("BT Fix Debug", msg); } catch(e) {}
}

// ─── Audio module ─────────────────────────────────────────────────────────────
var amName = "none";
var AudioManager = null;

if (RN.TurboModuleRegistry.get("RTNAudioManager")) {
  AudioManager = RN.TurboModuleRegistry.get("RTNAudioManager");
  amName = "RTNAudioManager";
} else if (RN.TurboModuleRegistry.get("NativeAudioManagerModule")) {
  AudioManager = RN.TurboModuleRegistry.get("NativeAudioManagerModule");
  amName = "NativeAudioManagerModule";
}

if (AudioManager) {
  var allMethods = Object.keys(AudioManager).filter(function(k) {
    return typeof AudioManager[k] === "function";
  });
  debug("Module: " + amName + "\nMethods: " + allMethods.join(", "));
} else {
  debug("FAILED: AudioManager is null.\nNeither RTNAudioManager nor NativeAudioManagerModule found.");
}

// ─── Patches ──────────────────────────────────────────────────────────────────
var patches = [];
var patchCount = 0;

function tryPatch(method, fn) {
  if (!AudioManager || typeof AudioManager[method] !== "function") return null;
  try {
    var p = instead(method, AudioManager, fn);
    patchCount++;
    return p;
  } catch(e) {
    debug("Patch error on " + method + ": " + e.message);
    return null;
  }
}

patches.push(tryPatch("setCommunicationModeOn", function(args, orig) {
  try { console.log("[BT-FIX] setCommunicationModeOn: " + args[0]); } catch(e) {}
  if (args[0]) return;
  return orig.apply(this, args);
}));

patches.push(tryPatch("setBluetoothScoOn", function(args, orig) {
  try { console.log("[BT-FIX] setBluetoothScoOn: " + args[0]); } catch(e) {}
  if (args[0] === true) return;
  return orig.apply(this, args);
}));

patches.push(tryPatch("startBluetoothSco", function() {
  try { console.log("[BT-FIX] startBluetoothSco blocked"); } catch(e) {}
}));

patches.push(tryPatch("setMode", function(args, orig) {
  try { console.log("[BT-FIX] setMode: " + args[0]); } catch(e) {}
  if (args[0] === 2 || args[0] === 3) return;
  return orig.apply(this, args);
}));

patches.push(tryPatch("setCommunicationDevice", function(args, orig) {
  var dev = args[0] || {};
  var t = dev.type || dev.deviceType || -1;
  try { console.log("[BT-FIX] setCommunicationDevice type: " + t); } catch(e) {}
  if (t === 8) return;
  return orig.apply(this, args);
}));

debug("Patches applied: " + patchCount + " / 5");

export const onUnload = function() {
  for (var i = 0; i < patches.length; i++) {
    try { patches[i] && patches[i](); } catch(e) {}
  }
};