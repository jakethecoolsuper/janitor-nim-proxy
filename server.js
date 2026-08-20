const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const NIM_API_BASE = "https://integrate.api.nvidia.com/v1";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Map OpenAI names and GLM to working NVIDIA NIM identifiers
const MODEL_MAPPING = {
  "gpt-4o": "z-ai/glm-5.2",
  "gpt-4": "meta/llama-3.3-70b-instruct",
  "gpt-3.5-turbo": "meta/llama-3.1-8b-instruct",
  "claude-3-opus": "deepseek-ai/deepseek-r1",
  "z-ai/glm-5.2": "z-ai/glm-5.2"
};

app.get("/health", (req, res) => {
  res.json({ status: "ok", key_loaded: !!NVIDIA_API_KEY });
});

app.get("/v1/models", (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map((id) => ({
    id: id,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "nvidia-nim-proxy"
  }));
  res.json({ object: "list", data: models });
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    if (!NVIDIA_API_KEY) {
      console.error("Missing NVIDIA_API_KEY in Render Environment!");
      return res.status(500).json({ error: { message: "NVIDIA_API_KEY missing in Render env vars." } });
    }

    // Resolve model name or fallback to Llama 3.3 70B
    const requestedModel = req.body.model || "gpt-4o";
    const nimModel = MODEL_MAPPING[requestedModel] || requestedModel;

    const payload = {
      ...req.body,
      model: nimModel,
      stream: req.body.stream ?? true
    };

    console.log(`Forwarding: ${requestedModel} -> ${nimModel} (Stream: ${payload.stream})`);

    const nvidiaResponse = await fetch(`${NIM_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY.trim()}`,
        "Content-Type": "application/json",
        "Accept": payload.stream ? "text/event-stream" : "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!nvidiaResponse.ok) {
      const errorText = await nvidiaResponse.text();
      console.error(`NVIDIA HTTP ${nvidiaResponse.status}:`, errorText);
      return res.status(nvidiaResponse.status).send(errorText);
    }

    // Stream directly back to Janitor AI
    if (payload.stream) {
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
    }

    const data = await nvidiaResponse.json();
    return res.json(data);

  } catch (err) {
    console.error("Proxy error:", err.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: { message: err.message } });
    }
    return res.end();
  }
});

app.use((req, res) => {
  res.status(404).json({ error: { message: "Endpoint not found" } });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
