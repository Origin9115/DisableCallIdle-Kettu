# DisableCallIdle for Kettu

Kettu/Vendetta-style Android plugin for disabling Discord's automatic 3-minute
idle disconnect in 1-to-1 DM voice calls.

## Target

Built for the Kettu plugin loader used by Kettu/Revenge-style clients.
The patch signatures are the same signatures used by the established
DisableCallIdle implementation: the `BOT_CALL_IDLE_DISCONNECT` path is stopped
before its `idleTimeout` is constructed, and `handleIdleUpdate()` returns before
its idle handling logic executes.

## Install

Host this directory on a public static host and paste the **folder URL** into
Kettu's plugin installer. The folder must expose `manifest.json` and `index.js`.

Example:

`https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/DisableCallIdle-Kettu-1.0.0/`

## Important

This package is correctly formatted for the Kettu/Vendetta loader, but I cannot
execute Discord 343.12 inside this environment. Therefore I cannot honestly
promise that Discord 343.12 still contains both exact source signatures.
If the plugin installs but the DM call still ends after 3 minutes, the next step
is to inspect the loaded Discord module and update the patch signature.
