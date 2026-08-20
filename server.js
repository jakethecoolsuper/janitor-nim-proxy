const express = require("express");

const app = express();

const PORT = process.env.PORT || 10000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

const NVIDIA_URL =
  "https://integrate.api.nvidia.com/v1/chat/completions";

const MODEL = "z-ai/glm-5.2";

/*
 * Allow large Janitor AI conversations.
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
 * Basic health check.
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
 * OpenAI-compatible model list.
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
 * Main OpenAI-compatible endpoint.
 */
app.post("/v1/chat/completions", async (req, res) => {
  try {
    if (!NVIDIA_API_KEY) {
      console.error("NVIDIA_API_KEY is not configured.");
      return res.status(500).json({
        error: {
          message: "NVIDIA_API_KEY is not configured on the server.",
          type: "configuration_error"
        }
      });
    }

    if (!req.body || !Array.isArray(req.body.messages)) {
      return res.status(400).json({
        error: {
          message: "A valid messages array is required.",
          type: "invalid_request_error"
        }
      });
    }

    /*
     * Copy the request from Janitor.
     * We force the model so Janitor cannot accidentally send
     * an invalid model name.
     */
    const body = {
      ...req.body,
      model: MODEL
    };

    /*
     * GLM-5.2 supports reasoning/thinking.
     *
     * We enable thinking for the model, but we do NOT expose
     * the model's private reasoning trace through this proxy.
     *
     * The final answer is still returned normally.
     */
    body.chat_template_kwargs = {
      ...(body.chat_template_kwargs || {}),
      enable_thinking: true
    };

    /*
     * Forward the request to NVIDIA NIM.
     */
    const upstream = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        "Accept": body.stream
          ? "text/event-stream"
          : "application/json"
      },
      body: JSON.stringify(body)
    });

    /*
     * If NVIDIA rejected the request, pass the error back to Janitor.
     */
    if (!upstream.ok) {
      const errorText = await upstream.text();

      console.error(
        `NVIDIA returned ${upstream.status}:`,
        errorText
      );

      res.status(upstream.status);

      res.setHeader("Content-Type", "application/json");

      return res.send(errorText);
    }

    /*
     * Streaming response.
     *
     * Janitor normally uses streaming, so we pass NVIDIA's
     * SSE stream through as it arrives.
     */
    if (body.stream) {
      res.status(upstream.status);

      res.setHeader(
        "Content-Type",
        "text/event-stream; charset=utf-8"
      );

      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");

      /*
       * Flush headers immediately.
       */
      res.flushHeaders();

      if (!upstream.body) {
        return res.end();
      }

      try {
        for await (const chunk of upstream.body) {
          res.write(chunk);
        }
      } catch (streamError) {
        console.error(
          "Streaming error:",
          streamError
        );
      }

      return res.end();
    }

    /*
     * Non-streaming response.
     */
    const responseText = await upstream.text();

    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");

    return res.send(responseText);

  } catch (error) {
    console.error("Proxy error:", error);

    if (!res.headersSent) {
      return res.status(500).json({
        error: {
          message: "Proxy server error.",
          type: "proxy_error",
          details: error.message
        }
      });
    }

    res.end();
  }
});

/*
 * Handle unknown routes.
 */
app.use((req, res) => {
  res.status(404).json({
    error: {
      message: "Endpoint not found.",
      type: "not_found"
    }
  });
});

/*
 * Render requires the server to listen on the provided PORT
 * and be reachable from 0.0.0.0.
 */
app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `NVIDIA NIM GLM-5.2 proxy running on port ${PORT}`
  );
});
