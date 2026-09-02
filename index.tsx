import definePlugin from "@utils/types";

/*
 * Diagnostic only.
 *
 * This plugin intentionally makes NO functional change to Discord.
 * It applies no-op replacements to several signatures related to the
 * known DM call-idle implementation. If a replacement is accepted by
 * Kettu, that tells us the corresponding signature exists in the loaded
 * Discord 343.12 bundle.
 *
 * The no-op replacements preserve the original code byte-for-byte at
 * runtime. They are deliberately minimal so this plugin is safe to leave
 * enabled while testing.
 */

const marker = (name: string) =>
    console.log(`[DisableCallIdle Diagnostic] matched: ${name}`);

export default definePlugin({
    name: "DisableCallIdle Diagnostic",
    description:
        "Detects which call-idle code signatures exist in the current Discord Android bundle. Does not disable calls or change Discord behavior.",
    authors: [{ name: "Origin9115" }],

    patches: [
        // Current Vencord implementation's primary signature.
        {
            find: "this.idleTimeout.start(",
            replacement: {
                match: /this\.idleTimeout\.(start|stop)/g,
                // Preserve the exact original operation; this is intentionally
                // a no-op replacement so we do not alter behavior.
                replace: "this.idleTimeout.$1"
            }
        },

        // Current Vencord implementation's second signature.
        {
            find: "handleIdleUpdate(){",
            replacement: {
                match: "handleIdleUpdate(){",
                replace: "handleIdleUpdate(){"
            }
        },

        // Older Bunny/mobile implementation marker.
        {
            find: "BOT_CALL_IDLE_DISCONNECT",
            replacement: {
                match: "BOT_CALL_IDLE_DISCONNECT",
                replace: "BOT_CALL_IDLE_DISCONNECT"
            }
        }
    ],

    noop() {
        // Kept as a stable plugin member for future diagnostic patches.
    },

    start() {
        marker("plugin started");
        console.log(
            "[DisableCallIdle Diagnostic] If Kettu reports patch matches for this plugin, the corresponding signatures exist in the loaded bundle."
        );
    },

    stop() {
        marker("plugin stopped");
    }
});
