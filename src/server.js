import "dotenv/config";
import { createApp } from "./app.js";
import { flushCatalogViews, startCatalogStatsFlushInterval } from "./stats.js";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const app = createApp();
const statsFlushInterval = startCatalogStatsFlushInterval();

app.listen(port, () => {
  console.log(
    JSON.stringify({
      event: "server_started",
      port,
      createdAt: new Date().toISOString()
    })
  );
});

const shutdown = async (signal) => {
  console.log(
    JSON.stringify({
      event: "server_stopping",
      signal,
      createdAt: new Date().toISOString()
    })
  );

  clearInterval(statsFlushInterval);
  await flushCatalogViews();
  process.exit(0);
};

process.on("SIGINT", () => {
  shutdown("SIGINT").catch((error) => {
    console.error(error);
    process.exit(1);
  });
});

process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch((error) => {
    console.error(error);
    process.exit(1);
  });
});
