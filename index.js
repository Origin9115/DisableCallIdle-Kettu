({
    name: "DisableCallIdle",
    description: "Disables Discord Android's 3-minute idle disconnect for 1-to-1 DM voice calls.",
    authors: [{ name: "OpenAI" }],
    patches: [
        {
            // Discord Android 343.12 CallIdleManager uses this exact object property
            // for the 180000 ms idle timer. Replacing start with stop keeps the timer
            // from ever being scheduled, while leaving the rest of CallIdleManager intact.
            find: "idleTimeout.start(",
            replacement: {
                match: /idleTimeout\.start/g,
                replace: "idleTimeout.stop"
            }
        }
    ]
})
