// No imports — everything through globals Kettu injects into the JS runtime

// ── Step 1: Get the 'instead' patcher function ───────────────────────────────
// Kettu/Bunny/Vendetta/Revenge all inject a global API object.
// We try every known name so this works regardless of mod version.
var _api = null;
if (typeof vendetta !== "undefined") { _api = vendetta; }
else if (typeof bunny   !== "undefined") { _api = bunny; }
else if (typeof revenge !== "undefined") { _api = revenge; }
else if (typeof kettu   !== "undefined") { _api = kettu; }

var _instead = (_api && _api.patcher && _api.patcher.instead) || null;

// ── Step 2: Get Discord's native audio module ─────────────────────────────────
// RNReactNative is a global Discord injects — used in the original plugin too.
var _rn = (typeof RNReactNative !== "undefined") ? RNReactNative : null;
var _am = null;
if (_rn && _rn.TurboModuleRegistry) {
  _am = _rn.TurboModuleRegistry.get("RTNAudioManager")
     || _rn.TurboModuleRegistry.get("NativeAudioManagerModule")
     || null;
}

// ── Step 3: Apply patches ─────────────────────────────────────────────────────
var _unpatches = [];

function _patch(method, fn) {
  if (!_am || !_instead || typeof _am[method] !== "function") return;
  try { _unpatches.push(_instead(method, _am, fn)); } catch(e) {}
}

// Block enable (true), allow disable (false) — this keeps A2DP alive
// and forces phone mic as input on all output modes
function _blockEnable(args, orig) {
  if (args[0]) return;
  return orig.apply(this, args);
}

_patch("setCommunicationModeOn", _blockEnable); // core fix
_patch("setBluetoothScoOn",      _blockEnable); // MIUI/HyperOS extra trigger
_patch("startBluetoothSco",      function() {}); // legacy API, always block
_patch("setMode", function(args, orig) {         // block IN_CALL(2)/IN_COMMUNICATION(3)
  if (args[0] === 2 || args[0] === 3) return;
  return orig.apply(this, args);
});

// ── Step 4: Export cleanup for when plugin is disabled ────────────────────────
function _cleanup() {
  for (var i = 0; i < _unpatches.length; i++) {
    try { _unpatches[i] && _unpatches[i](); } catch(e) {}
  }
}

module.exports = { onUnload: _cleanup };