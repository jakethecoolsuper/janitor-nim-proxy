const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODEL = "z-ai/glm-5.2";

/*
 * Reddit Fix: Explicit payload limit settings
 */
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

/*
 * CORS Setup for Janitor AI
 */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/*
 * Health checks
 */
app.get("/", (req, res) => {
  res.json({ status: "online", service: "NVIDIA NIM Proxy", model: MODEL });
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", model: MODEL });
});

/*
 * OpenAI-compatible model list endpoint
 */
app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      {
        id: MODEL,
        object: "model",
        created: Math.floor(Date.now() / 1000),
        owned_by: "z-ai"
      }
    ]
  });
});

/*
 * Main Chat Endpoint (SSE Stream Handling)
 */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const payload = {
      ...req.body,
      model: MODEL,
      stream: true
    };

    const nvidiaResponse = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Accept": "text/event-stream"
      },
      body: JSON.stringify(payload)
    });

    if (!nvidiaResponse.ok) {
      const errorText = await nvidiaResponse.text();
      console.error("NVIDIA API Error:", errorText);
      return res.status(nvidiaResponse.status).send(errorText);
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const reader = nvidiaResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    return res.end();
  } catch (err) {
    console.error("Proxy Error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: { message: err.message } });
    }
    return res.end();
  }
});

app.use((req, res) => {
  res.status(404).json({ error: { message: "Endpoint not found.", type: "not_found" } });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NVIDIA NIM Proxy running on port ${PORT}`);
});
