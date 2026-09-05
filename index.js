import { ReactNative as RN } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

const TAG = "[AudioFix Debug]";
const patches = [];

function getAudioManager() {
    try {
        const turbo = RN?.TurboModuleRegistry;
        if (!turbo?.get) return null;

        const native = turbo.get("NativeAudioManagerModule");
        if (native) return native;

        return turbo.get("RTNAudioManager");
    } catch (e) {
        console.log(TAG, "Failed to get audio manager", e);
        return null;
    }
}

function summarize(value, depth = 0) {
    if (depth > 2) return "[Object]";
    if (value == null) return value;

    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") return value;
    if (type === "function") return "[Function]";

    if (Array.isArray(value)) return value.map(v => summarize(v, depth + 1));

    if (type === "object") {
        const out = {};
        for (const key of Object.keys(value).slice(0, 30)) {
            try { out[key] = summarize(value[key], depth + 1); } catch { out[key] = "[Unreadable]"; }
        }
        return out;
    }

    return String(value);
}

const audio = getAudioManager();

if (!audio) {
    console.log(TAG, "No Discord audio manager module found");
} else {
    const names = [
        ...new Set([
            ...Object.keys(audio),
            ...Object.getOwnPropertyNames(audio),
            ...Object.getOwnPropertyNames(Object.getPrototypeOf(audio) || {}),
        ]),
    ];

    console.log(TAG, "Audio manager:", audio);
    console.log(TAG, "Methods/properties:", names);

    // Preserve the original fix: Discord cannot enable communication/hands-free mode.
    try {
        const unpatch = instead(
            "setCommunicationModeOn",
            audio,
            () => {
                console.log(TAG, "BLOCKED setCommunicationModeOn()");
                return undefined;
            },
        );
        patches.push(unpatch);
    } catch (e) {
        console.log(TAG, "Could not patch setCommunicationModeOn", e);
    }

    // Observe every audio-manager call so we can identify exactly what Discord calls
    // when the user taps Bluetooth / Phone / Speaker.
    for (const name of names) {
        if (name === "setCommunicationModeOn") continue;

        let original;
        try { original = audio[name]; } catch { continue; }
        if (typeof original !== "function") continue;

        try {
            const descriptor = Object.getOwnPropertyDescriptor(audio, name);
            if (descriptor && descriptor.writable === false && descriptor.set == null) continue;

            audio[name] = function (...args) {
                console.log(TAG, "CALL", name, summarize(args));
                return original.apply(this, args);
            };

            patches.push(() => {
                try { audio[name] = original; } catch { /* ignore */ }
            });
        } catch {
            // Some TurboModule properties cannot be replaced. That's fine.
        }
    }

    console.log(TAG, "Debug hooks installed. Tap Bluetooth, Phone, and Speaker in a call.");
}

export const onUnload = () => {
    for (let i = patches.length - 1; i >= 0; i--) {
        try { patches[i](); } catch { /* ignore */ }
    }
    console.log(TAG, "Unloaded");
};
