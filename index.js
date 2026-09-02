({
  name: "DisableCallIdle",
  description: "Prevents Discord from automatically disconnecting an idle 1-to-1 DM voice call after 3 minutes.",
  authors: [{ name: "OpenAI" }],
  patches: [
    {
      find: ".Messages.BOT_CALL_IDLE_DISCONNECT",
      replacement: {
        match: /,?(?=\i\(this,"idleTimeout",new \i\.\i\))/, 
        replace: ";return;"
      }
    },
    {
      find: "handleIdleUpdate(){",
      replacement: {
        match: /(?<=_initialize\(\){)/,
        replace: "return;"
      }
    }
  ]
})
