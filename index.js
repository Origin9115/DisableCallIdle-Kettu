import { ReactNative } from "@vendetta/metro/common";
import { instead } from "@vendetta/patcher";

const TAG = "[AudioFix Debug]";
const patches = [];

function getAudioManager() {
    try {
        const turbo = ReactNative.TurboModuleRegistry;
        if (!turbo || !turbo.get) return null;

        const native = turbo.get("NativeAudioManagerModule");
        if (native) return native;

        return turbo.get("RTNAudioManager");
    } catch (e) {
        console.log(TAG, "getAudioManager failed", String(e));
        return null;
    }
}

function safeValue(value, depth) {
    if (depth > 2) return "[Object]";
    if (value === null || value === undefined) return value;

    const type = typeof value;
    if (type === "string" || type === "number" || type === "boolean") return value;
    if (type === "function") return "[Function]";

    if (Array.isArray(value)) {
        return value.slice(0, 20).map(function (item) {
            return safeValue(item, depth + 1);
        });
    }

    if (type === "object") {
        const out = {};
        let keys = [];
        try {
            keys = Object.keys(value).slice(0, 30);
        } catch (_) {
            return "[Object]";
        }

        for (const key of keys) {
            try {
                out[key] = safeValue(value[key], depth + 1);
            } catch (_) {
                out[key] = "[Unreadable]";
            }
        }
        return out;
    }

    return String(value);
}

const audio = getAudioManager();

console.log(TAG, "plugin loaded");

if (!audio) {
    console.log(TAG, "Audio manager not found");
} else {
    let names = [];

    try {
        names = Object.getOwnPropertyNames(audio);
        const proto = Object.getPrototypeOf(audio);
        if (proto) names = names.concat(Object.getOwnPropertyNames(proto));
        names = Array.from(new Set(names));
    } catch (e) {
        console.log(TAG, "Could not enumerate audio manager", String(e));
    }

    console.log(TAG, "Audio manager methods:", names);

    // Preserve the ORIGINAL audiofix behavior exactly:
    // Discord's request to enter hands-free/communication mode is blocked.
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
        console.log(TAG, "FAILED to hook setCommunicationModeOn", String(e));
    }

    // Log calls made to the audio manager. We DO NOT alter these calls yet.
    for (const name of names) {
        if (name === "setCommunicationModeOn") continue;

        let fn = null;
        try {
            fn = audio[name];
        } catch (_) {
            continue;
        }

        if (typeof fn !== "function") continue;

        try {
            const original = fn;
            audio[name] = function () {
                const args = Array.from(arguments).map(function (v) {
                    return safeValue(v, 0);
                });
                console.log(TAG, "CALL", name, args);
                return original.apply(this, arguments);
            };

            patches.push(function () {
                try {
                    audio[name] = original;
                } catch (_) {}
            });
        } catch (_) {
            // Some TurboModule methods are not writable; ignore them.
        }
    }

    console.log(TAG, "call tracing installed");
    console.log(TAG, "Now test: Bluetooth -> Phone -> Speaker -> Bluetooth");
}

export const onUnload = function () {
    for (let i = patches.length - 1; i >= 0; i--) {
        try {
            patches[i]();
        } catch (_) {}
    }
    console.log(TAG, "unloaded");
};
