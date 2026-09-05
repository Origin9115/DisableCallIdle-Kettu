import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

// Resolve whichever audio native module Discord is using on this device
const m = RN.TurboModuleRegistry.get("RTNAudioManager") || RN.TurboModuleRegistry.get("NativeAudioManagerModule");

// Shared interceptor: block enable calls, pass disable calls through
const blockEnable = (args, orig) => args[0] ? void 0 : orig(...args);

// Apply all patches — skip any method that doesn't exist on this device
const unpatches = !m ? [] : [
  instead("setCommunicationModeOn", m, blockEnable),
  m.setBluetoothScoOn  ? instead("setBluetoothScoOn",  m, blockEnable)              : null,
  m.startBluetoothSco  ? instead("startBluetoothSco",  m, () => {})                 : null,
  m.stopBluetoothSco   ? null                                                        : null,
  m.setMode            ? instead("setMode", m, (a, o) => a[0] > 1 ? void 0 : o(...a)) : null,
];

export const onUnload = () => unpatches.forEach(u => u?.());