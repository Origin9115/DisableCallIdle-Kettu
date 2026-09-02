(function () {
  "use strict";

  return {
    name: "DisableCallIdle",
    description: "Prevents Discord from disconnecting an idle 1-to-1 DM voice call after the call-idle timeout.",
    authors: [{ name: "Origin9115" }],

    patches: [
      {
        // Current Vencord implementation and the known mobile implementation
        // both expose the call-idle timeout through idleTimeout.start/stop.
        find: "this.idleTimeout.start(",
        replacement: {
          match: /this\.idleTimeout\.(start|stop)/g,
          replace: "$self.noop"
        }
      },
      {
        // Prevents the idle update handler from disconnecting/moving the call.
        find: "handleIdleUpdate(){",
        replacement: {
          match: "handleIdleUpdate(){",
          replace: "handleIdleUpdate(){return;"
        }
      },
      {
        // Compatibility fallback for older Discord mobile bundles that exposed
        // the disconnect marker directly in the call-idle scheduling module.
        find: ".Messages.BOT_CALL_IDLE_DISCONNECT",
        replacement: {
          match: /,?(?=\i\(this,"idleTimeout",new \i\.\i\))/,
          replace: ";return;"
        }
      }
    ],

    noop() {}
  };
})()
