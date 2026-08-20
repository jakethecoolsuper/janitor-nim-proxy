const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

// Default model to GLM-5.2
const DEFAULT_MODEL = "z-ai/glm-5.2";

/*
 * Increase limits for large Janitor AI context payloads
 */
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

/*
 * CORS Configuration for Browser & Janitor Requests
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
 * Health Checks
 */
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "NVIDIA NIM Multi-Model Proxy",
    model: DEFAULT_MODEL
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    model: DEFAULT_MODEL
  });
});

/*
 * OpenAI-Compatible Model List
 */
app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "z-ai/glm-5.2", object: "model", created: Date.now(), owned_by: "z-ai" },
      { id: "deepseek-ai/deepseek-r1", object: "model", created: Date.now(), owned_by: "deepseek" },
      { id: "meta/llama-3.3-70b-instruct", object: "model", created: Date.now(), owned_by: "meta" }
    ]
  });
});

/*
 * Streaming Proxy Endpoint
 */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    // If Janitor passes a model, use it; otherwise fallback to GLM-5.2
    const targetModel = req.body.model || DEFAULT_MODEL;

    // Force stream to true for real-time output delivery
    const payload = {
      ...req.body,
      model: targetModel,
      stream: true
    };

    // Forward request to NVIDIA NIM
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
      const errData = await nvidiaResponse.text();
      console.error("NVIDIA API Error:", errData);
      return res.status(nvidiaResponse.status).send(errData);
    }

    // Set Server-Sent Event (SSE) headers for streaming to Janitor
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Pipe NVIDIA stream chunks straight to Janitor AI
    const reader = nvidiaResponse.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(decoder.decode(value, { stream: true }));
    }

    return res.end();
  } catch (err) {
    console.error("Proxy Processing Error:", err);
    if (!res.headersSent) {
      return res.status(500).json({ error: { message: err.message } });
    }
    return res.end();
  }
});

/*
 * Fallback Route
 */
app.use((req, res) => {
  res.status(404).json({ error: { message: "Endpoint not found.", type: "not_found" } });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NVIDIA NIM Proxy running on port ${PORT}`);
});
