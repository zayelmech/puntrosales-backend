import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogsPath = path.resolve(__dirname, "../catalogs.json");

const resolveEnvPlaceholders = (value) => {
  if (typeof value !== "string") {
    return value;
  }

  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, envName) => {
    const envValue = process.env[envName];

    if (!envValue) {
      throw new Error(`Missing environment variable ${envName} for catalogs.json`);
    }

    return envValue;
  });
};

const validateCatalog = (catalog) => {
  if (!catalog || typeof catalog !== "object") {
    throw new Error("Invalid catalog entry in catalogs.json");
  }

  if (typeof catalog.publicKey !== "string" || catalog.publicKey.trim() === "") {
    throw new Error("Catalog publicKey must be a non-empty string");
  }

  catalog.firebaseUrl = resolveEnvPlaceholders(catalog.firebaseUrl);

  if (typeof catalog.firebaseUrl !== "string" || catalog.firebaseUrl.trim() === "") {
    throw new Error(`Catalog ${catalog.publicKey} must include a firebaseUrl`);
  }

  if (typeof catalog.enabled !== "boolean") {
    throw new Error(`Catalog ${catalog.publicKey} enabled must be boolean`);
  }

  if (!Number.isInteger(catalog.cacheTtlSeconds) || catalog.cacheTtlSeconds < 0) {
    throw new Error(`Catalog ${catalog.publicKey} cacheTtlSeconds must be a non-negative integer`);
  }
};

const loadCatalogs = () => {
  const rawCatalogs = fs.readFileSync(catalogsPath, "utf8");
  const catalogs = JSON.parse(rawCatalogs);

  if (!Array.isArray(catalogs)) {
    throw new Error("catalogs.json must contain an array");
  }

  catalogs.forEach(validateCatalog);

  return new Map(catalogs.map((catalog) => [catalog.publicKey, catalog]));
};

const catalogMap = loadCatalogs();

export const getCatalogByPublicKey = (publicKey) => catalogMap.get(publicKey);
