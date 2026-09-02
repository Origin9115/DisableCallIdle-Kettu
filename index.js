vendetta => {
    "use strict";

    const NAME = "DisableCallIdle";
    const TARGET = "BOT_CALL_IDLE_DISCONNECT";
    const unpatches = [];
    const patched = new Set();

    const log = (...args) => {
        try {
            if (vendetta?.logger?.log) vendetta.logger.log(`[${NAME}]`, ...args);
        } catch {}
    };

    const error = (...args) => {
        try {
            if (vendetta?.logger?.error) vendetta.logger.error(`[${NAME}]`, ...args);
            else if (vendetta?.logger?.log) vendetta.logger.log(`[${NAME}]`, ...args);
        } catch {}
    };

    function fnSource(fn) {
        try {
            return Function.prototype.toString.call(fn);
        } catch {
            return "";
        }
    }

    function isTargetStart(fn) {
        const source = fnSource(fn);
        return source.includes(TARGET);
    }

    function patchPrototype(proto, label) {
        if (!proto || typeof proto.start !== "function") return false;
        if (!isTargetStart(proto.start)) return false;
        if (patched.has(proto)) return true;

        try {
            const unpatch = vendetta.patcher.after(
                `${NAME}:${label}`,
                proto,
                "start",
                function (args) {
                    // spitroast preserves the original `this` context.
                    // The call-idle timer exposes stop() on its instance.
                    try {
                        if (typeof this?.stop === "function") this.stop();
                    } catch (e) {
                        error("could not stop call-idle timeout", e);
                    }
                }
            );

            if (typeof unpatch === "function") unpatches.push(unpatch);
            patched.add(proto);
            log(`patched ${label}`);
            return true;
        } catch (e) {
            error(`failed to patch ${label}`, e);
            return false;
        }
    }

    function inspectExport(value, label, seen) {
        if (!value || (typeof value !== "object" && typeof value !== "function")) return;
        if (seen.has(value)) return;
        seen.add(value);

        // Timeout is commonly exported as a class/function.
        if (typeof value === "function") {
            patchPrototype(value.prototype, `${label}.prototype`);
        }

        // Some Discord modules expose an object directly.
        if (typeof value.start === "function" && isTargetStart(value.start)) {
            if (!patched.has(value)) {
                try {
                    const unpatch = vendetta.patcher.after(
                        `${NAME}:${label}`,
                        value,
                        "start",
                        function () {
                            try {
                                if (typeof this?.stop === "function") this.stop();
                            } catch (e) {
                                error("could not stop call-idle timeout", e);
                            }
                        }
                    );
                    if (typeof unpatch === "function") unpatches.push(unpatch);
                    patched.add(value);
                    log(`patched ${label}`);
                } catch (e) {
                    error(`failed to patch ${label}`, e);
                }
            }
        }

        // Handle the common default-export shape and shallow module wrappers.
        try {
            if (value.default && value.default !== value) {
                inspectExport(value.default, `${label}.default`, seen);
            }
        } catch {}
    }

    function scan() {
        const metro = vendetta?.metro;
        if (!metro) {
            error("Vendetta metro API is unavailable");
            return;
        }

        const seen = new Set();
        let modules = [];

        try {
            if (typeof metro.findAll === "function") {
                modules = metro.findAll(() => true) || [];
            }
        } catch (e) {
            error("module scan failed", e);
        }

        // Fast path for the historical Timeout module shape.
        try {
            if (typeof metro.findByProps === "function") {
                const candidate = metro.findByProps("start", "stop");
                if (candidate) inspectExport(candidate, "findByProps(start,stop)", seen);
            }
        } catch (e) {
            error("direct Timeout lookup failed", e);
        }

        for (let i = 0; i < modules.length; i++) {
            try {
                inspectExport(modules[i], `module[${i}]`, seen);

                // A module can export an object containing the constructor.
                if (modules[i] && typeof modules[i] === "object") {
                    for (const key of Object.keys(modules[i])) {
                        if (key === "__esModule") continue;
                        const value = modules[i][key];
                        if (typeof value === "function") {
                            inspectExport(value, `module[${i}].${key}`, seen);
                        }
                    }
                }
            } catch {}
        }

        if (!patched.size) {
            log(`no ${TARGET} timeout found in the currently loaded modules`);
        } else {
            log(`enabled; ${patched.size} target(s) patched`);
        }
    }

    return {
        onLoad() {
            scan();
        },

        onUnload() {
            for (const unpatch of unpatches.splice(0)) {
                try { unpatch(); } catch {}
            }
            patched.clear();
            log("disabled");
        }
    };
};
