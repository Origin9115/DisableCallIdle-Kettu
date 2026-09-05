import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

var am = RN.TurboModuleRegistry.get("RTNAudioManager") || RN.TurboModuleRegistry.get("NativeAudioManagerModule");
var unpatches = [];

function patch(method, fn) {
  if (!am || typeof am[method] !== "function") return;
  try { unpatches.push(instead(method, am, fn)); } catch(e) {}
}

// Block enabling SCO/HFP — keeps Bluetooth in A2DP (high quality)
// and forces phone mic as input on all output modes.
// Allow disabling so audio routing resets when switching devices.
patch("setCommunicationModeOn", function(args, orig) {
  if (args[0]) return;
  return orig.apply(this, args);
});

// Extra methods MIUI/HyperOS/Samsung use to enable SCO independently
patch("setBluetoothScoOn", function(args, orig) {
  if (args[0]) return;
  return orig.apply(this, args);
});

patch("startBluetoothSco", function() {});

patch("setMode", function(args, orig) {
  if (args[0] === 2 || args[0] === 3) return;
  return orig.apply(this, args);
});

patch("setCommunicationDevice", function(args, orig) {
  if (((args[0] || {}).type || -1) === 8) return;
  return orig.apply(this, args);
});

export const onUnload = function() {
  for (var i = 0; i < unpatches.length; i++) {
    try { unpatches[i](); } catch(e) {}
  }
};