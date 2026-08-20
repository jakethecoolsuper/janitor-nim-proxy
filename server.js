// server.js - OpenAI to NVIDIA NIM API Proxy for Render
const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || "https://integrate.api.nvidia.com/v1";
const NIM_API_KEY = process.env.NVIDIA_API_KEY || process.env.NIM_API_KEY;

// 🔥 REASONING DISPLAY TOGGLE - Shows/hides reasoning in output (<think> tags)
const SHOW_REASONING = false;

// 🔥 THINKING MODE TOGGLE - Enables chat_template_kwargs thinking
const ENABLE_THINKING_MODE = false;

// Model mapping to NVIDIA NIM
const MODEL_MAPPING = {
  "gpt-3.5-turbo": "meta/llama-3.1-8b-instruct",
  "gpt-4": "meta/llama-3.3-70b-instruct",
  "gpt-4o": "z-ai/glm-5.2",
  "claude-3-opus": "deepseek-ai/deepseek-r1",
  "z-ai/glm-5.2": "z-ai/glm-5.2"
};

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "OpenAI to NVIDIA NIM Proxy",
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE
  });
});

app.get("/", (req, res) => {
  res.json({ status: "online", service: "NVIDIA NIM Proxy" });
});

// List models endpoint
app.get("/v1/models", (req, res) => {
  const models = Object.keys(MODEL_MAPPING).map((model) => ({
    id: model,
    object: "model",
    created: Math.floor(Date.now() / 1000),
    owned_by: "nvidia-nim-proxy"
  }));

  res.json({ object: "list", data: models });
});

// Chat completions endpoint
app.post("/v1/chat/completions", async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;

    // Resolve target model
    const nimModel = MODEL_MAPPING[model] || model || "z-ai/glm-5.2";

    // Transform request to NIM format
    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature ?? 0.6,
      max_tokens: max_tokens ?? 4096,
      extra_body: ENABLE_THINKING_MODE ? { chat_template_kwargs: { thinking: true } } : undefined,
      stream: stream ?? true
    };

    const nvidiaResponse = await fetch(`${NIM_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NIM_API_KEY}`,
        "Content-Type": "application/json",
        Accept: nimRequest.stream ? "text/event-stream" : "application/json"
      },
      body: JSON.stringify(nimRequest)
    });

    if (!nvidiaResponse.ok) {
      const errorText = await nvidiaResponse.text();
      console.error("NVIDIA API Error:", errorText);
      return res.status(nvidiaResponse.status).send(errorText);
    }

    // Handle Streaming Output (SSE)
    if (nimRequest.stream) {
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

    // Handle Non-Streaming Output
    const data = await nvidiaResponse.json();
    return res.json(data);
  } catch (error) {
    console.error("Proxy error:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        error: { message: error.message || "Internal server error" }
      });
    }
    return res.end();
  }
});

// Fallback endpoint
app.use((req, res) => {
  res.status(404).json({ error: { message: "Endpoint not found", type: "not_found" } });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Proxy running on port ${PORT}`);
});
