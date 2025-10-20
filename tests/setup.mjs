process.env.TZ = "UTC";

import net from "node:net";

const originalListen = net.Server.prototype.listen;

net.Server.prototype.listen = function patchedListen(...args) {
  if (args.length > 0) {
    const first = args[0];
    if (typeof first === "object" && first !== null) {
      first.host = first.host && first.host !== "0.0.0.0" ? first.host : "127.0.0.1";
    } else if (typeof first === "number") {
      const second = args[1];
      if (typeof second === "string" || typeof second === "undefined") {
        args[1] = second && second !== "0.0.0.0" ? second : "127.0.0.1";
      } else if (typeof second === "object" && second !== null) {
        second.host = second.host && second.host !== "0.0.0.0" ? second.host : "127.0.0.1";
      }
    }
  }

  return originalListen.apply(this, args);
};
