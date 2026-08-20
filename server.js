const express = require("express");
const cors = require("cors");
const axios = require("axios");
const http = require("http");
const https = require("https");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const NIM_API_BASE = "https://integrate.api.nvidia.com/v1";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Custom HTTP/HTTPS agents to prevent sockets from dropping
const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const MODEL_MAPPING = {
  "gpt-4o": "meta/llama-3.3-70b-instruct",
  "gpt-4": "meta/llama-3.3-70b-instruct",
  "gpt-3.5-turbo": "meta/llama-3.1-8b-instruct",
  "claude-3-opus": "deepseek-ai/deepseek-r1",
  "z-ai/glm-5.2": "z-ai/glm-5.2",
  "deepseek": "deepseek-ai/deepseek-v4-pro",
  "nvidia": "nvidia/nemotron-3-ultra-550b-a55b"
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

    const requestedModel = req.body.model || "gpt-4o";
    const nimModel = MODEL_MAPPING[requestedModel] || requestedModel;

    const payload = {
      ...req.body,
      model: nimModel,
      stream: req.body.stream ?? true
    };

    console.log(`Forwarding request: ${requestedModel} -> ${nimModel}`);

    const response = await axios({
      method: "post",
      url: `${NIM_API_BASE}/chat/completions`,
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY.trim()}`,
        "Content-Type": "application/json"
      },
      data: payload,
      responseType: payload.stream ? "stream" : "json",
      httpAgent,
      httpsAgent,
      timeout: 120000 // 2-minute timeout
    });

    if (payload.stream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      response.data.pipe(res);

      response.data.on("error", (err) => {
        console.error("Stream pipe error:", err.message);
        res.end();
      });
    } else {
      return res.json(response.data);
    }

  } catch (err) {
    const errorDetails = err.response ? JSON.stringify(err.response.data) : err.message;
    console.error("Proxy Axios Error:", errorDetails);
    
    if (!res.headersSent) {
      return res.status(err.response?.status || 500).json({
        error: { message: `NVIDIA API Error: ${errorDetails}` }
      });
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
