import "dotenv/config";
import { createApp } from "./app.js";

const port = Number.parseInt(process.env.PORT || "8080", 10);
const app = createApp();

app.listen(port, () => {
  console.log(
    JSON.stringify({
      event: "server_started",
      port,
      createdAt: new Date().toISOString()
    })
  );
});
