import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Load .env manually (no dotenv dependency needed)
try {
  const envPath = path.join(__dirname, "..", ".env");
  const envFile = readFileSync(envPath, "utf-8");
  envFile.split("\n").forEach((line) => {
    const [key, ...val] = line.split("=");
    if (key && !key.startsWith("#")) process.env[key.trim()] = val.join("=").trim();
  });
} catch (e) {}

const PORT = process.env.PORT || 3001;
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// DexScreener proxy (free, no key)
app.get("/api/dex/search", async (req, res) => {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(req.query.q)}`);
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// OpenRouter proxy (key stays on server)
app.post("/api/verdict", async (req, res) => {
  if (!process.env.OPENROUTER_KEY) return res.status(500).json({ error: "OPENROUTER_KEY not set in .env" });
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Anthropic proxy (tweet search)
app.post("/api/tweets", async (req, res) => {
  if (!process.env.ANTHROPIC_KEY) return res.status(500).json({ error: "ANTHROPIC_KEY not set in .env" });
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(req.body),
    });
    res.json(await r.json());
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Serve frontend
app.use(express.static(path.join(__dirname, "..", "frontend", "dist")));
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "..", "frontend", "dist", "index.html")));

app.listen(PORT, () => {
  console.log(`\n  ✓ ishealarpornot running → http://localhost:${PORT}`);
  console.log(`  OPENROUTER_KEY: ${process.env.OPENROUTER_KEY ? "✓" : "✗ MISSING"}`);
  console.log(`  ANTHROPIC_KEY:  ${process.env.ANTHROPIC_KEY ? "✓" : "✗ MISSING"}\n`);
});
