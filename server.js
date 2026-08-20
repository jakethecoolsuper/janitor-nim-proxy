const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const MODEL = "z-ai/glm-5.2";

/*
 * Allow large Janitor AI conversations and body sizes.
 */
app.use(express.json({ limit: "100mb" }));
app.use(express.urlencoded({ limit: "100mb", extended: true }));

/*
 * CORS
 * Allows Janitor/browser clients to communicate with the proxy.
 */
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, OPTIONS"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

/*
 * Health checks
 */
app.get("/", (req, res) => {
  res.json({
    status: "online",
    service: "NVIDIA NIM GLM-5.2 Proxy",
    model: MODEL
  });
});

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    model: MODEL
  });
});

/*
 * OpenAI-compatible model list
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
 * Main Chat Endpoint
 */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    // Strip unnecessary params that might disrupt NVIDIA, force non-streaming
    const body = { ...req.body };
    delete body.stream;

    const payload = {
      ...body,
      model: MODEL,
      stream: false
    };

    const response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${NVIDIA_API_KEY}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("NVIDIA API Error:", data);
      return res.status(response.status).json(data);
    }

    // Force strict OpenAI compliance formatting for Janitor AI
    return res.status(200).json(data);
  } catch (err) {
    console.error("Proxy Error:", err);
    return res.status(500).json({
      error: {
        message: err.message || "Internal Proxy Error",
        type: "proxy_error"
      }
    });
  }
});

/*
 * Fallback route for unknown endpoints
 */
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: "Endpoint not found.",
      type: "not_found"
    }
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`NVIDIA NIM GLM-5.2 proxy running on port ${PORT}`);
});
