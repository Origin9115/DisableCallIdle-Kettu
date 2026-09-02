# DisableCallIdle — Kettu / Android

Build target: Discord 343.12 + Kettu 1.4.3.

This version does not depend on a fixed Discord Metro module ID. It scans loaded Metro
exports for the Discord call-idle implementation and patches methods whose source
contains `idleTimeout.start/stop`, `handleIdleUpdate`, or `BOT_CALL_IDLE_DISCONNECT`.

The implementation is based on the current DisableCallIdle behavior used by Vencord,
which patches the client code containing `idleTimeout.start()` and `handleIdleUpdate()`.

## Installation

Host `manifest.json` and `index.js` at a public URL and add that URL in Kettu's plugin
installer. The folder must expose both files directly.

## Verification

After enabling the plugin, check Kettu/Vendetta logs for either:
- `patched handleIdleUpdate`
- `patched ... on call-idle module`
- `enabled; patched N target(s)`

If it says `No call-idle implementation was found`, the Discord 343.12 bundle is using a
signature not covered by this build and the plugin should not be considered working.
