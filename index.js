import { ReactNative as RN } from "@vendetta/metro/common";
import { findByProps } from "@vendetta/metro";
import { instead, after } from "@vendetta/patcher";
import { FluxDispatcher } from "@vendetta/metro/common";

const patches = [];

// ─────────────────────────────────────────────────────────────────────────────
// 1.  NATIVE AUDIO MODULE
//     Resolve the correct TurboModule for the current RN version.
// ─────────────────────────────────────────────────────────────────────────────
const AudioManager =
  RN.TurboModuleRegistry.get("RTNAudioManager") ??
  RN.TurboModuleRegistry.get("NativeAudioManagerModule");

// ─────────────────────────────────────────────────────────────────────────────
// 2.  PATCH 1 — Block SCO / Bluetooth handsfree profile
//     setCommunicationModeOn(true)  → blocked  (keeps BT in A2DP, phone mic used)
//     setCommunicationModeOn(false) → allowed   (clears routing when leaving BT)
// ─────────────────────────────────────────────────────────────────────────────
if (AudioManager?.setCommunicationModeOn) {
  patches.push(
    instead("setCommunicationModeOn", AudioManager, (args, orig) => {
      if (args[0]) return; // block enabling SCO/HFP
      return orig(...args); // allow disabling so routing resets properly
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.  PATCH 2 — Force UI to show the correct selected device
//
//     Discord's audio device picker sometimes doesn't re-render after you
//     tap a device because the JS store doesn't receive a change notification.
//
//     Strategy:
//       a) Find the JS-side media engine store (multiple prop-name fallbacks).
//       b) After any device-selection call completes, force the store to emit
//          a change so every subscribed component re-renders.
//       c) Also intercept the native module's device-selection methods so we
//          can fire the same emit even when the change comes from the native side.
// ─────────────────────────────────────────────────────────────────────────────

// --- 3a. Find the store ---
const MediaEngineStore =
  findByProps("getOutputVolume", "getAudioDevice") ??
  findByProps("getOutputVolume", "getCommunicationAudioDevice") ??
  findByProps("getMediaEngine", "isDeaf") ??
  findByProps("getCurrentSpeakerDevice") ??
  findByProps("getAudioDevice");

// Helper: trigger a store change notification so the UI re-renders.
function forceUIRefresh() {
  try {
    // Primary: ask the store to emit directly.
    MediaEngineStore?.emitChange?.();

    // Secondary: dispatch a Flux event that the audio device picker listens to.
    // We try several known action types (Discord renames these over versions).
    const types = [
      "MEDIA_ENGINE_SET_OUTPUT_VOLUME",
      "AUDIO_DEVICE_CHANGED",
      "VOICE_SETTINGS_UPDATE",
      "AUDIO_OUTPUT_DEVICE_CHANGED",
    ];
    for (const type of types) {
      try { FluxDispatcher.dispatch({ type }); } catch {}
    }
  } catch {}
}

// --- 3b. Patch JS-side device-selection actions ---
// Discord's JS layer has an actions/utilities module that sets the active
// audio device. We try several known property-name combinations.
const DeviceActions =
  findByProps("setAudioDevice", "getAudioInputDevices") ??
  findByProps("selectAudioOutputDevice", "selectAudioInputDevice") ??
  findByProps("setAudioDevice") ??
  findByProps("selectAudioDevice") ??
  findByProps("setAudioOutputDevice");

if (DeviceActions) {
  // Determine which method name is present.
  const methodName = [
    "setAudioDevice",
    "selectAudioOutputDevice",
    "selectAudioDevice",
    "setAudioOutputDevice",
  ].find((m) => typeof DeviceActions[m] === "function");

  if (methodName) {
    patches.push(
      after(methodName, DeviceActions, () => {
        // Give Discord a tick to update its internal state, then refresh the UI.
        setTimeout(forceUIRefresh, 50);
      })
    );
  }
}

// --- 3c. Patch native-side device selection as a safety net ---
// Even if the JS method isn't found, the native module may be called directly.
// Intercept every method on the AudioManager whose name suggests device switching
// and fire the same UI refresh after them.
if (AudioManager) {
  const deviceSelectMethods = Object.keys(AudioManager).filter((k) =>
    /device|output|route/i.test(k) &&
    k !== "setCommunicationModeOn" &&
    typeof AudioManager[k] === "function"
  );

  for (const method of deviceSelectMethods) {
    try {
      patches.push(
        after(method, AudioManager, () => {
          setTimeout(forceUIRefresh, 50);
        })
      );
    } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.  CLEANUP — remove all patches when the plugin is disabled
// ─────────────────────────────────────────────────────────────────────────────
export const onUnload = () => patches.forEach((p) => p?.());