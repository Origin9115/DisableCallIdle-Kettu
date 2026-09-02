# DisableCallIdle — Discord Android 343.12 / Kettu

This plugin targets the Android `CallIdleManager` implementation used by Discord 343.12.

The verified Hermes bytecode contains a module-level constant of exactly `180000` ms.
The `handleEmbeddedActivityDisconnect` and `handleVoiceStateUpdates` handlers pass the
captured value to `idleTimeout.start(...)` together with the `disconnect` callback.

The patch replaces `idleTimeout.start` with `idleTimeout.stop`, preventing the 3-minute
idle timer from being scheduled while preserving the rest of the call-state logic.
