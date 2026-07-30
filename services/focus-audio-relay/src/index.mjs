import { loadConfig } from "./config.mjs";
import { createRelayServer } from "./server.mjs";

let config;
try {
  config = loadConfig();
} catch (error) {
  console.error(`[focus-audio-relay] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const server = createRelayServer({ config });
server.listen(config.port, config.host, () => {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event: "relay_started",
    host: config.host,
    port: config.port,
  }));
});

function shutdown(signal) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "info",
    event: "relay_stopping",
    signal,
  }));
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
