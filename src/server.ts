import "dotenv/config";
import express from "express";
import { connectDB } from "./config/database";

const app = express();
app.use(express.json());

const port = Number(process.env.PORT ?? 3000);

app.get("/", (_req, res) => {
  res.send("GrantManagement API is running");
});

async function startServer() {
  try {
    await connectDB();

    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exitCode = 1;
  }
}

void startServer();