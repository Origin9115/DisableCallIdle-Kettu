import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

// ─── Debug toast helper ───────────────────────────────────────────────────────
function toast(msg) {
  try {
    RN.ToastAndroid.show("[BT Fix] " + msg, RN.ToastAndroid.LONG);
  } catch(e) {}
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

toast("Module: " + amName);

// Show which SCO-related methods exist on the module
if (AudioManager) {
  var found = [];
  var checkMethods = [
    "setCommunicationModeOn", "setBluetoothScoOn",
    "startBluetoothSco", "setMode", "setCommunicationDevice"
  ];
  for (var i = 0; i < checkMethods.length; i++) {
    if (typeof AudioManager[checkMethods[i]] === "function") {
      found.push(checkMethods[i]);
    }
  }
  toast("Methods: " + (found.length > 0 ? found.join(", ") : "NONE FOUND"));

  // Also show ALL method names on the module so we can see what's available
  var allMethods = Object.keys(AudioManager).filter(function(k) {
    return typeof AudioManager[k] === "function";
  });
  toast("All methods: " + allMethods.join(", "));
} else {
  toast("AudioManager is NULL - no module found!");
}

// ─── Patch attempt ────────────────────────────────────────────────────────────
var patchCount = 0;

function tryPatch(method, fn) {
  if (!AudioManager || typeof AudioManager[method] !== "function") return null;
  try {
    var p = instead(method, AudioManager, fn);
    patchCount++;
    return p;
  } catch(e) {
    toast("Patch failed: " + method + " - " + e.message);
    return null;
  }
}

var patches = [];

patches.push(tryPatch("setCommunicationModeOn", function(args, orig) {
  toast("setCommunicationModeOn called: " + args[0]);
  if (args[0]) return;
  return orig.apply(this, args);
}));

patches.push(tryPatch("setBluetoothScoOn", function(args, orig) {
  toast("setBluetoothScoOn called: " + args[0]);
  if (args[0] === true) return;
  return orig.apply(this, args);
}));

patches.push(tryPatch("startBluetoothSco", function() {
  toast("startBluetoothSco blocked!");
}));

patches.push(tryPatch("setMode", function(args, orig) {
  toast("setMode called: " + args[0]);
  if (args[0] === 2 || args[0] === 3) return;
  return orig.apply(this, args);
}));

patches.push(tryPatch("setCommunicationDevice", function(args, orig) {
  var dev = args[0] || {};
  var t = dev.type || dev.deviceType || -1;
  toast("setCommunicationDevice type: " + t);
  if (t === 8) return;
  return orig.apply(this, args);
}));

toast("Patches applied: " + patchCount);

// ─── Cleanup ──────────────────────────────────────────────────────────────────
export const onUnload = function() {
  for (var i = 0; i < patches.length; i++) {
    try { patches[i] && patches[i](); } catch(e) {}
  }
};