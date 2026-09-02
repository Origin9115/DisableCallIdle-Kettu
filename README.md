# DisableCallIdle Kettu Diagnostic

Target: Discord Android 343.12 / Kettu 1.4.3.

This is intentionally a **diagnostic-only** plugin. It does not disable Discord's
call-idle timeout. It exists to identify which known call-idle signatures are present
in the loaded Discord bundle before making the final patch.

Source files:
- `manifest.json`
- `index.tsx`

The source should be built with the Kettu/Revenge plugin build system; the resulting
plugin artifact contains `manifest.json` and `index.js`.
