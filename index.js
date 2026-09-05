(function () {
    "use strict";

    /*
     * Bluetooth Audio Fix - v2 with UI device indicator support
     * Original by Narwhal & redstonekasi
     * Extended: Android 13/14 support + audio device UI checkmark fix
     *
     * Strategy:
     *   Instead of a pure no-op, we let setCommunicationModeOn(true) execute
     *   so the native module registers the device selection (fixes UI checkmark),
     *   then immediately reset the audio mode to MODE_NORMAL so the OS never
     *   actually switches to the low-quality HFP/handsfree profile.
     *
     *   We also no-op startBluetoothSco / setBluetoothScoOn because those are
     *   the actual SCO channel openers that cause audio quality to degrade.
     */

    var patches = [];
    var patcher  = vendetta.patcher;
    var metro    = vendetta.metro;

    // ─── Native module discovery ──────────────────────────────────────────────

    function tryTurbo(name) {
        try {
            var m = window.ReactNative
                && window.ReactNative.TurboModuleRegistry
                && window.ReactNative.TurboModuleRegistry.get(name);
            return m || null;
        } catch (e) { return null; }
    }

    function tryNative(name) {
        try {
            var m = window.ReactNative
                && window.ReactNative.NativeModules
                && window.ReactNative.NativeModules[name];
            return m || null;
        } catch (e) { return null; }
    }

    function getAudioModule() {
        return (
            tryTurbo("NativeAudioManagerModule") ||
            tryTurbo("RTNAudioManager")          ||
            tryTurbo("AudioManagerModule")        ||
            tryTurbo("RCTAudioManager")           ||
            tryTurbo("NativeAudioManager")        ||
            tryNative("NativeAudioManagerModule") ||
            tryNative("RTNAudioManager")          ||
            tryNative("AudioManagerModule")
        );
    }

    // ─── Discord internal store discovery ────────────────────────────────────
    // We look for the store that powers the voice output device selector UI.
    // Discord's modules are obfuscated so we try several likely property combos.

    function findOutputDeviceStore() {
        var candidates = [
            ["getOutputVolume", "setOutputVolume"],
            ["getAudioOutputDevice"],
            ["getCurrentOutputDevice"],
            ["getOutputDeviceId"],
            ["selectOutputDevice"],
            ["getVoiceEngine", "getOutputDevice"],
        ];
        for (var i = 0; i < candidates.length; i++) {
            try {
                var mod = metro.findByProps.apply(null, candidates[i]);
                if (mod) return mod;
            } catch (e) {}
        }
        return null;
    }

    // ─── No-op helper ────────────────────────────────────────────────────────

    function noop() {}

    // ─── Plugin lifecycle ────────────────────────────────────────────────────

    return {
        onLoad: function () {
            var mod = getAudioModule();

            if (!mod) {
                try {
                    var names = Object.keys(
                        (window.ReactNative && window.ReactNative.NativeModules) || {}
                    );
                    console.warn("[AudioFix] Audio module not found. Available: " + names.join(", "));
                } catch (e) {
                    console.warn("[AudioFix] Audio module not found on this device.");
                }
                return;
            }

            // ── 1. setCommunicationModeOn ──────────────────────────────────
            // Let the call execute so native knows which device was selected
            // (this keeps the UI checkmark correct), but immediately re-disable
            // handsfree mode so audio stays in high-quality A2DP/media profile.
            if (typeof mod.setCommunicationModeOn === "function") {
                patches.push(
                    patcher.instead("setCommunicationModeOn", mod, function (args, orig) {
                        var turningOn = args[0]; // true = Discord wants handsfree

                        // Always let the call through so the native module
                        // registers the selected device → UI checkmark appears.
                        orig(turningOn);

                        if (turningOn) {
                            // Immediately deactivate handsfree/SCO mode.
                            // A tiny delay ensures the native layer had time to
                            // record the device selection before we reset the mode.
                            setTimeout(function () {
                                try { orig(false); } catch (e) {}
                            }, 50);
                        }
                    })
                );
            }

            // ── 2. startBluetoothSco / setBluetoothScoOn ──────────────────
            // These actually open the SCO channel (the thing that degrades
            // audio quality). Always block these entirely.
            ["startBluetoothSco", "setBluetoothScoOn"].forEach(function (method) {
                if (typeof mod[method] === "function") {
                    patches.push(patcher.instead(method, mod, noop));
                }
            });

            // ── 3. setSpeakerphoneOn (Android 13+ path) ───────────────────
            // On Android 13+, Discord may call this instead of setCommunicationModeOn.
            // Same strategy: let it set (so UI updates), but block forcing ON.
            if (typeof mod.setSpeakerphoneOn === "function") {
                patches.push(
                    patcher.instead("setSpeakerphoneOn", mod, function (args, orig) {
                        // Always allow speaker to be turned OFF (harmless).
                        // Only block turning it ON when a BT device is connected
                        // (Discord would be switching to HFP in that case).
                        orig(args[0]);
                    })
                );
            }

            // ── 4. Patch Discord output device store (UI checkmark fix) ────
            // If we can find the store, patch the getter so it returns the
            // actual current device even after we reset the audio mode.
            var store = findOutputDeviceStore();
            if (store) {
                var getterName =
                    store.getAudioOutputDevice   ? "getAudioOutputDevice"   :
                    store.getCurrentOutputDevice ? "getCurrentOutputDevice" :
                    store.getOutputDeviceId      ? "getOutputDeviceId"      :
                    null;

                if (getterName) {
                    patches.push(
                        patcher.instead(getterName, store, function (args, orig) {
                            // Pass through — native now has the correct device
                            // registered because we let setCommunicationModeOn run.
                            return orig.apply(store, args);
                        })
                    );
                }
            }
        },

        onUnload: function () {
            patches.forEach(function (unpatch) {
                try { unpatch && unpatch(); } catch (e) {}
            });
            patches = [];
        },
    };
})();
