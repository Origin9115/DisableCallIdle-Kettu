// No imports, no exports — pure globals only
const _patcher = (typeof vendetta !== "undefined" && vendetta?.patcher)
  || (typeof bunny    !== "undefined" && bunny?.patcher)
  || (typeof revenge  !== "undefined" && revenge?.patcher)
  || null;

const _instead = _patcher?.instead || null;

// RNReactNative is a global Discord injects into the JS runtime
const _rn = (typeof RNReactNative !== "undefined" && RNReactNative)
  || (typeof __turboModuleProxy !== "undefined" && { TurboModuleRegistry: { get: (n) => __turboModuleProxy(n) } })
  || null;

const _am = _rn
  ? (_rn.TurboModuleRegistry.get("RTNAudioManager") || _rn.TurboModuleRegistry.get("NativeAudioManagerModule"))
  : null;

const _u = [];
const _blk = (a, o) => a[0] ? void 0 : o(...a);

if (_am && _instead) {
  _u.push(_instead("setCommunicationModeOn", _am, _blk));
  if (_am.setBluetoothScoOn)  _u.push(_instead("setBluetoothScoOn",  _am, _blk));
  if (_am.startBluetoothSco)  _u.push(_instead("startBluetoothSco",  _am, () => {}));
  if (_am.setMode)            _u.push(_instead("setMode", _am, (a, o) => a[0] > 1 ? void 0 : o(...a)));
}

module.exports = {
  onUnload: () => _u.forEach(f => f && f())
};