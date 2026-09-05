// Self-contained — no imports, no external patcher needed.
// We implement method patching directly so there are zero dependencies.

// ── Own 'instead' implementation ─────────────────────────────────────────────
// Replaces obj[method] with fn, passes (args, originalFn) to fn.
// Returns a cleanup function that restores the original method.
function patch(obj, method, fn) {
  if (!obj || typeof obj[method] !== "function") return function() {};
  var original = obj[method];
  obj[method] = function() {
    var args = Array.prototype.slice.call(arguments);
    return fn(args, original.bind(obj));
  };
  return function() { obj[method] = original; };
}

// ── Get Discord's native audio module ────────────────────────────────────────
// RNReactNative is injected by Discord into the JS runtime as a global.
var am = null;
if (typeof RNReactNative !== "undefined" && RNReactNative.TurboModuleRegistry) {
  am = RNReactNative.TurboModuleRegistry.get("RTNAudioManager")
    || RNReactNative.TurboModuleRegistry.get("NativeAudioManagerModule")
    || null;
}

// ── Patches ───────────────────────────────────────────────────────────────────
var unpatches = [];

// Block enable (true) → keeps Bluetooth in A2DP and phone mic as input
// Allow disable (false) → lets routing reset when switching output device
function blockEnable(args, orig) {
  if (args[0]) return;
  return orig.apply(this, args);
}

if (am) {
  unpatches.push(patch(am, "setCommunicationModeOn", blockEnable));
  unpatches.push(patch(am, "setBluetoothScoOn",      blockEnable));
  unpatches.push(patch(am, "startBluetoothSco",      function() {}));
  unpatches.push(patch(am, "setMode", function(args, orig) {
    if (args[0] === 2 || args[0] === 3) return; // block IN_CALL and IN_COMMUNICATION
    return orig.apply(this, args);
  }));
}

// ── Cleanup when plugin is disabled ──────────────────────────────────────────
module.exports = {
  onUnload: function() {
    for (var i = 0; i < unpatches.length; i++) {
      try { unpatches[i](); } catch(e) {}
    }
  }
};