import express from "express";
import cors from "cors";
import helmet from "helmet";
import { catalogCache } from "./cache.js";
import { getCatalogByPublicKey } from "./catalogs.js";
import { logJson } from "./logger.js";

const FETCH_TIMEOUT_MS = 8000;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
const allowedOrigins = new Set([
  "https://www.imecatro.com",
  "https://imecatro.com",
  "http://localhost:3000",
  "http://localhost:5173"
]);

const visitsByPublicKey = new Map();
const rateLimitByIp = new Map();

setInterval(() => {
  const now = Date.now();

  for (const [ip, entry] of rateLimitByIp.entries()) {
    if (entry.resetAt <= now) {
      rateLimitByIp.delete(ip);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

const getClientIp = (req) => {
  const forwardedFor = req.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip;
};

const jsonError = (res, status, message) => res.status(status).json({ error: message });

const rateLimitByClientIp = (req, res, next) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const current = rateLimitByIp.get(ip);

  if (!current || current.resetAt <= now) {
    rateLimitByIp.set(ip, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS
    });
    next();
    return;
  }

  current.count += 1;

  if (current.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((current.resetAt - now) / 1000);

    res.set("Retry-After", String(retryAfterSeconds));
    jsonError(res, 429, "Too many requests");
    return;
  }

  next();
};

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }

    const error = new Error("Origin not allowed by CORS");
    error.statusCode = 403;
    callback(error);
  },
  methods: ["GET", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  optionsSuccessStatus: 204
};

const fetchCatalogJsonText = async (firebaseUrl) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(firebaseUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      const error = new Error("Firebase responded with an error");
      error.statusCode = 502;
      throw error;
    }

    const responseText = await response.text();

    try {
      JSON.parse(responseText);
    } catch {
      const error = new Error("Firebase response is not JSON");
      error.statusCode = 502;
      throw error;
    }

    return responseText;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Firebase request timed out");
      timeoutError.statusCode = 504;
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

export const createApp = () => {
  const app = express();

  app.set("trust proxy", true);
  app.use(helmet());
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));
  app.use(rateLimitByClientIp);

  app.get("/health", (_req, res) => {
    res.type("text/plain").send("OK");
  });

  app.get("/c/:publicKey", async (req, res, next) => {
    const { publicKey } = req.params;
    const catalog = getCatalogByPublicKey(publicKey);

    if (!catalog) {
      jsonError(res, 404, "Catalog not found");
      return;
    }

    if (!catalog.enabled) {
      jsonError(res, 403, "Catalog disabled");
      return;
    }

    try {
      let cacheStatus = "HIT";
      let catalogJsonText = catalogCache.get(publicKey);

      if (!catalogJsonText) {
        cacheStatus = "MISS";
        catalogJsonText = await fetchCatalogJsonText(catalog.firebaseUrl);
        catalogCache.set(publicKey, catalogJsonText, catalog.cacheTtlSeconds);
      }

      visitsByPublicKey.set(publicKey, (visitsByPublicKey.get(publicKey) || 0) + 1);

      logJson({
        event: "catalog_visit",
        publicKey,
        ip: getClientIp(req),
        userAgent: req.get("user-agent") || null,
        referer: req.get("referer") || null,
        cache: cacheStatus,
        createdAt: new Date().toISOString()
      });

      res.set("X-PuntroSales-Cache", cacheStatus);
      res.type("application/json").send(catalogJsonText);
    } catch (error) {
      next(error);
    }
  });

  app.get("/stats/:publicKey", (req, res) => {
    const { publicKey } = req.params;

    if (!getCatalogByPublicKey(publicKey)) {
      jsonError(res, 404, "Catalog not found");
      return;
    }

    res.json({
      publicKey,
      visits: visitsByPublicKey.get(publicKey) || 0
    });
  });

  app.use((_req, res) => {
    jsonError(res, 404, "Not found");
  });

  app.use((error, _req, res, _next) => {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
      logJson({
        event: "app_error",
        statusCode,
        message: error.message,
        createdAt: new Date().toISOString()
      });
    }

    jsonError(res, statusCode, statusCode === 500 ? "Internal server error" : error.message);
  });

  return app;
};
