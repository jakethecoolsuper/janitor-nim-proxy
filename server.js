const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

const NIM_API_BASE = "https://integrate.api.nvidia.com/v1";
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

// Model fallback map
const FALLBACK_MODEL = "meta/llama-3.3-70b-instruct";

app.get("/health", (req, res) => {
  res.json({ status: "ok", key_loaded: !!NVIDIA_API_KEY });
});

app.get("/v1/models", (req, res) => {
  res.json({
    object: "list",
    data: [
      { id: "z-ai/glm-5.2", object: "model" },
      { id: "meta/llama-3.3-70b-instruct", object: "model" },
      { id: "deepseek-ai/deepseek-r1", object: "model" }
    ]
  });
});

app.post("/v1/chat/completions", async (req, res) => {
  try {
    if (!NVIDIA_API_KEY) {
      console.error("Missing NVIDIA_API_KEY in Render Environment!");
      return res.status(500).json({ error: { message: "NVIDIA_API_KEY missing in Render env vars." } });
    }

    const requestedModel = req.body.model || "meta/llama-3.3-70b-instruct";

    const payload = {
      ...req.body,
      model: requestedModel,
      stream: false // Keep stream false for troubleshooting
    };

    console.log(`Sending request to NVIDIA for model: ${requestedModel}`);

    const nvidiaResponse = await fetch(`${NIM_API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const responseText = await nvidiaResponse.text();

    if (!nvidiaResponse.ok) {
      console.error(`NVIDIA returned HTTP ${nvidiaResponse.status}:`, responseText);
      return res.status(nvidiaResponse.status).send(responseText);
    }

    try {
      const data = JSON.parse(responseText);
      return res.json(data);
    } catch (e) {
      return res.send(responseText);
    }

  } catch (err) {
    console.error("Fetch Exception Error Details:", err);
    return res.status(500).json({
      error: {
        message: `Proxy internal fetch error: ${err.message}`,
        type: "fetch_failed"
      }
    });
  }
});

app.use((req, res) => {
  res.status(404).json({ error: { message: "Endpoint not found" } });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
