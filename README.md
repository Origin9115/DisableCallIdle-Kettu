# DisableCallIdle for Kettu

Target: Discord Android 343.12 / Kettu 1.4.3

This is a Kettu/Vendetta-style plugin. It only patches a timeout `start()` method when the function source contains `BOT_CALL_IDLE_DISCONNECT`, then calls `stop()` on that timeout instance.

SHA-256 (index.js): `669b4936ae44cde2b51af4ae632734a3062c324eb7d25932f0f4aa4c5b39c574`

## Install
Host this folder so the URL directly contains `manifest.json` and `index.js`, then paste the folder URL into Kettu's plugin installer.

## Stability note
The source is deliberately defensive and does not disable unrelated timers. It is nevertheless impossible to certify it as fully stable for Discord 343.12 without executing it against that exact Discord build.
