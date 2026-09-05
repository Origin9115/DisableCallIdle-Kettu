(function () {
    "use strict";

    /*
     * Bluetooth Audio Fix - Fixed for Android 13/14
     * Original by Narwhal & redstonekasi
     * Fixed for broader device compatibility (Redmi Note 14 Pro, Samsung, etc.)
     *
     * Root cause: Discord changed the native audio module name on newer Android/app versions.
     * Fix: Try ALL known module names and patch ALL relevant methods.
     */

    var patches = [];

    function tryGet(name) {
        try {
            var mod = window.ReactNative
                && window.ReactNative.TurboModuleRegistry
                && window.ReactNative.TurboModuleRegistry.get(name);
            if (mod) return mod;
        } catch (e) {}
        try {
            var mod2 = window.ReactNative
                && window.ReactNative.NativeModules
                && window.ReactNative.NativeModules[name];
            if (mod2) return mod2;
        } catch (e) {}
        return null;
    }

    function getAudioModule() {
        // Try every known Discord audio module name across versions
        return (
            tryGet("NativeAudioManagerModule") ||  // old Discord
            tryGet("RTNAudioManager")             ||  // newer Discord
            tryGet("AudioManagerModule")          ||  // Samsung / MIUI variants
            tryGet("RCTAudioManager")             ||  // legacy RN name
            tryGet("NativeAudioManager")             // fallback
        );
    }

    function noop() {}

    return {
        onLoad: function () {
            var mod = getAudioModule();

            if (!mod) {
                // Last resort: dump all NativeModules so the user can report the correct name
                try {
                    var names = Object.keys(window.ReactNative.NativeModules || {});
                    console.warn("[AudioFix] Could not find audio module. Available modules: " + names.join(", "));
                } catch (e) {
                    console.warn("[AudioFix] Could not find audio module on this device.");
                }
                return;
            }

            // Patch every method Discord uses to activate handsfree / HFP mode
            var methods = [
                "setCommunicationModeOn",   // original target
                "startBluetoothSco",        // Android 12 path
                "setBluetoothScoOn",        // some Samsung ROMs
                "setSpeakerphoneOn",        // fallback used on Android 13+
            ];

            methods.forEach(function (method) {
                if (typeof mod[method] === "function") {
                    patches.push(
                        vendetta.patcher.instead(method, mod, noop)
                    );
                }
            });

            if (patches.length === 0) {
                console.warn("[AudioFix] Module found but no patchable methods detected.");
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
