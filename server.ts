import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getFiles(dir: string, baseDir: string): Promise<{ path: string; content: string }[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const res = path.resolve(dir, entry.name);
      const relativePath = path.relative(baseDir, res);

      // Exclude common ignored directories and files
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".git" ||
        entry.name === "package-lock.json" ||
        entry.name === ".DS_Store"
      ) {
        return [];
      }

      if (entry.isDirectory()) {
        return getFiles(res, baseDir);
      } else {
        try {
          const content = await fs.readFile(res, "utf-8");
          return [{ path: relativePath, content }];
        } catch (e) {
          console.error(`Error reading file ${res}:`, e);
          return [];
        }
      }
    })
  );
  return files.flat();
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '100mb' }));

  // API route to get source code
  app.get("/api/source-code", async (req, res) => {
    try {
      const files = await getFiles(__dirname, __dirname);
      res.json(files);
    } catch (error) {
      console.error("Error fetching source code:", error);
      res.status(500).json({ error: "Failed to fetch source code" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
