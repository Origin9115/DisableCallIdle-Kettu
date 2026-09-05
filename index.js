import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

const TAG = "[AudioFix Debug]";
const patches = [];

// Keep the exact native-module selection used by the known-working plugin.
const audio = RNReactNative.TurboModuleRegistry.get("NativeAudioManagerModule") === null
    ? RN.TurboModuleRegistry.get("RTNAudioManager")
    : RN.TurboModuleRegistry.get("NativeAudioManagerModule");

console.log(TAG, "loaded");
console.log(TAG, "audio manager:", audio ? "found" : "missing");

if (audio) {
    // Log the names exposed by the same native module used by audiofix.
    try {
        const own = Object.getOwnPropertyNames(audio);
        console.log(TAG, "own properties:", own);
    } catch (e) {
        console.log(TAG, "could not enumerate own properties:", String(e));
    }

    // Preserve the original audiofix behavior exactly.
    try {
        patches.push(instead(
            "setCommunicationModeOn",
            audio,
            function () {
                console.log(TAG, "BLOCKED setCommunicationModeOn", Array.from(arguments));
                return undefined;
            }
        ));
        console.log(TAG, "setCommunicationModeOn hook installed");
    } catch (e) {
        console.log(TAG, "setCommunicationModeOn hook FAILED", String(e));
    }

    // Try to observe other callable native methods without changing their behavior.
    try {
        const names = Object.getOwnPropertyNames(audio);
        for (const name of names) {
            if (name === "setCommunicationModeOn") continue;

            let value;
            try {
                value = audio[name];
            } catch (_) {
                continue;
            }
            if (typeof value !== "function") continue;

            try {
                audio[name] = function () {
                    console.log(TAG, "CALL", name, Array.from(arguments));
                    return value.apply(this, arguments);
                };
                patches.push(() => {
                    try { audio[name] = value; } catch (_) {}
                });
            } catch (_) {}
        }
    } catch (e) {
        console.log(TAG, "method tracing setup FAILED", String(e));
    }

    console.log(TAG, "tracing ready");
}

export const onUnload = () => {
    for (let i = patches.length - 1; i >= 0; i--) {
        try { patches[i](); } catch (_) {}
    }
};
