(function () {
    "use strict";

    const PATCH_ID = "DisableCallIdle";
    const metro = window?.vendetta?.metro || window?.bunny?.api?.metro || window?.bunny?.metro;
    const patcher = window?.vendetta?.patcher || window?.bunny?.api?.patcher || window?.bunny?.patcher;
    const logger = window?.vendetta?.logger || window?.bunny?.api?.logger;

    const say = (...args) => {
        try {
            if (typeof logger?.log === "function") return logger.log(`[${PATCH_ID}]`, ...args);
            console.log(`[${PATCH_ID}]`, ...args);
        } catch {}
    };

    const unpatches = [];
    const seenObjects = new Set();
    const seenMethods = new Set();
    let hits = 0;

    function fnSource(fn) {
        try {
            return typeof fn === "function" ? Function.prototype.toString.call(fn) : "";
        } catch {
            return "";
        }
    }

    function addUnpatch(p) {
        if (typeof p === "function") unpatches.push(p);
    }

    function patchMethod(obj, key, fn) {
        if (!obj || typeof fn !== "function") return;
        const marker = `${key}:${fn}`;
        if (seenMethods.has(marker)) return;
        seenMethods.add(marker);

        // Current Discord desktop implementation has two relevant signatures:
        //   1) this.idleTimeout.start(...) / this.idleTimeout.stop(...)
        //   2) handleIdleUpdate(){...}
        // On mobile, minification can change surrounding code, so we identify the
        // method by its source rather than by a module ID or exported class name.
        const src = fnSource(fn);
        if (!src) return;

        if (/(^|[^\w])handleIdleUpdate\s*\(/.test(src)) {
            try {
                addUnpatch(patcher.instead(key, obj, function () { return; }));
                hits++;
                say("patched handleIdleUpdate");
                return;
            } catch (e) {
                say("handleIdleUpdate patch failed", e);
            }
        }

        if (/idleTimeout\s*\.(?:start|stop)\s*\(/.test(src) || src.includes("BOT_CALL_IDLE_DISCONNECT")) {
            try {
                addUnpatch(patcher.instead(key, obj, function () { return; }));
                hits++;
                say(`patched ${String(key)} on call-idle module`);
            } catch (e) {
                say(`call-idle patch failed for ${String(key)}`, e);
            }
        }
    }

    function inspect(value, depth) {
        if (!value || depth > 3) return;
        const type = typeof value;
        if (type !== "object" && type !== "function") return;
        if (seenObjects.has(value)) return;
        seenObjects.add(value);

        // Inspect own properties. Discord Metro modules are commonly objects with
        // one or more exported functions/classes.
        let keys = [];
        try { keys = Object.getOwnPropertyNames(value); } catch { return; }

        for (const key of keys) {
            if (key === "length" || key === "name" || key === "prototype" || key === "caller" || key === "arguments") continue;
            let child;
            try { child = value[key]; } catch { continue; }

            if (typeof child === "function") {
                patchMethod(value, key, child);
                // Inspect the prototype of classes/functions too.
                try {
                    const proto = child.prototype;
                    if (proto && proto !== Object.prototype) inspect(proto, depth + 1);
                } catch {}
            } else if (child && (typeof child === "object" || typeof child === "function")) {
                const src = fnSource(child);
                if (src && (src.includes("idleTimeout") || src.includes("handleIdleUpdate") || src.includes("BOT_CALL_IDLE_DISCONNECT"))) {
                    inspect(child, depth + 1);
                }
            }
        }
    }

    function scan() {
        if (!metro || !patcher) {
            say("Kettu/Vendetta Metro or patcher API is unavailable");
            return;
        }

        let modules = [];
        try {
            if (typeof metro.findAll === "function") {
                modules = metro.findAll(() => true) || [];
            } else if (typeof metro.find === "function") {
                const one = metro.find(() => true);
                if (one) modules = [one];
            }
        } catch (e) {
            say("Metro scan failed", e);
            return;
        }

        for (const mod of modules) inspect(mod, 0);

        if (!hits) {
            say("No call-idle implementation was found in loaded Metro modules");
        } else {
            say(`enabled; patched ${hits} target(s)`);
        }
    }

    return {
        onLoad() {
            // Discord may lazy-load call UI modules. Scan now and repeat briefly so
            // the patch catches a module that appears immediately after startup.
            scan();
            const timers = [500, 1500, 3000, 6000, 10000];
            for (const ms of timers) {
                const id = setTimeout(scan, ms);
                unpatches.push(() => clearTimeout(id));
            }
        },

        onUnload() {
            for (const fn of unpatches.splice(0)) {
                try { fn(); } catch {}
            }
            say("disabled");
        }
    };
})();
