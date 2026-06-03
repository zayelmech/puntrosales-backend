import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogMetadataCache } from "./cache.js";
import { getFirestoreDb } from "./firestore.js";
import { logJson } from "./logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const catalogsPath = path.resolve(__dirname, "../catalogs.json");
const metadataTtlSeconds = Number.parseInt(process.env.CATALOG_METADATA_TTL_SECONDS || "60", 10);
const firestoreCollection = process.env.FIRESTORE_CATALOG_COLLECTION || "catalog_public_routes";
let localCatalogMap = null;
let localCatalogLoadFailed = false;

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

const normalizeCatalog = (catalog, source) => {
  if (!catalog || typeof catalog !== "object") {
    throw new Error(`Invalid catalog entry from ${source}`);
  }

  if (typeof catalog.publicKey !== "string" || catalog.publicKey.trim() === "") {
    throw new Error(`Catalog from ${source} must include a non-empty publicKey`);
  }

  const normalizedCatalog = {
    publicKey: catalog.publicKey,
    firebaseUrl: resolveEnvPlaceholders(catalog.firebaseUrl),
    enabled: catalog.enabled,
    cacheTtlSeconds: catalog.cacheTtlSeconds
  };

  if (typeof normalizedCatalog.firebaseUrl !== "string" || normalizedCatalog.firebaseUrl.trim() === "") {
    throw new Error(`Catalog ${normalizedCatalog.publicKey} from ${source} must include a firebaseUrl`);
  }

  if (typeof normalizedCatalog.enabled !== "boolean") {
    throw new Error(`Catalog ${normalizedCatalog.publicKey} from ${source} enabled must be boolean`);
  }

  if (!Number.isInteger(normalizedCatalog.cacheTtlSeconds) || normalizedCatalog.cacheTtlSeconds < 0) {
    throw new Error(
      `Catalog ${normalizedCatalog.publicKey} from ${source} cacheTtlSeconds must be a non-negative integer`
    );
  }

  return normalizedCatalog;
};

const loadCatalogs = () => {
  const rawCatalogs = fs.readFileSync(catalogsPath, "utf8");
  const catalogs = JSON.parse(rawCatalogs);

  if (!Array.isArray(catalogs)) {
    throw new Error("catalogs.json must contain an array");
  }

  return new Map(
    catalogs.map((catalog) => {
      const normalizedCatalog = normalizeCatalog(catalog, "catalogs.json");
      return [normalizedCatalog.publicKey, normalizedCatalog];
    })
  );
};

const getLocalCatalogByPublicKey = (publicKey) => {
  if (localCatalogLoadFailed) {
    return null;
  }

  try {
    if (!localCatalogMap) {
      localCatalogMap = loadCatalogs();
    }

    return localCatalogMap.get(publicKey) || null;
  } catch (error) {
    localCatalogLoadFailed = true;
    logJson({
      event: "catalogs_json_load_failed",
      message: error.message,
      createdAt: new Date().toISOString()
    });
    return null;
  }
};

const getFirestoreCatalogByPublicKey = async (publicKey) => {
  const db = getFirestoreDb();
  if (!db) {
    return null;
  }

  const snapshot = await db.collection(firestoreCollection).doc(publicKey).get();

  if (!snapshot.exists) {
    return null;
  }

  return normalizeCatalog(
    {
      publicKey,
      ...snapshot.data()
    },
    `Firestore ${firestoreCollection}/${publicKey}`
  );
};

export const getCatalogByPublicKey = async (publicKey) => {
  const cachedCatalog = catalogMetadataCache.get(publicKey);
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const catalog = (await getFirestoreCatalogByPublicKey(publicKey)) || getLocalCatalogByPublicKey(publicKey);

  if (catalog) {
    catalogMetadataCache.set(publicKey, catalog, metadataTtlSeconds);
  }

  return catalog;
};

export const invalidateCatalogMetadata = (publicKey) => {
  catalogMetadataCache.del(publicKey);
};
