import admin from "firebase-admin";
import { getFirestoreDb } from "./firestore.js";
import { logJson } from "./logger.js";

const statsCollection = process.env.FIRESTORE_STATS_COLLECTION || "catalog_stats";
const flushIntervalMs = Number.parseInt(process.env.STATS_FLUSH_INTERVAL_SECONDS || "60", 10) * 1000;
const maxCatalogsPerBatch = 200;
const pendingViewsByPublicKey = new Map();

let flushInProgress = false;

const getTodayKey = () => new Date().toISOString().slice(0, 10);

export const recordCatalogView = (publicKey) => {
  pendingViewsByPublicKey.set(publicKey, (pendingViewsByPublicKey.get(publicKey) || 0) + 1);
};

export const getPendingCatalogViews = (publicKey) => pendingViewsByPublicKey.get(publicKey) || 0;

export const flushCatalogViews = async () => {
  if (flushInProgress || pendingViewsByPublicKey.size === 0) {
    return;
  }

  const db = getFirestoreDb();
  if (!db) {
    return;
  }

  flushInProgress = true;
  const flushEntries = Array.from(pendingViewsByPublicKey.entries());

  for (const [publicKey] of flushEntries) {
    pendingViewsByPublicKey.delete(publicKey);
  }

  try {
    const now = admin.firestore.FieldValue.serverTimestamp();
    const todayKey = getTodayKey();

    for (let index = 0; index < flushEntries.length; index += maxCatalogsPerBatch) {
      const batch = db.batch();
      const chunk = flushEntries.slice(index, index + maxCatalogsPerBatch);

      for (const [publicKey, views] of chunk) {
        const statsRef = db.collection(statsCollection).doc(publicKey);
        const dailyRef = statsRef.collection("daily").doc(todayKey);

        batch.set(
          statsRef,
          {
            publicKey,
            totalViews: admin.firestore.FieldValue.increment(views),
            lastViewedAt: now,
            updatedAt: now
          },
          { merge: true }
        );

        batch.set(
          dailyRef,
          {
            publicKey,
            date: todayKey,
            views: admin.firestore.FieldValue.increment(views),
            updatedAt: now
          },
          { merge: true }
        );
      }

      await batch.commit();
    }

    logJson({
      event: "catalog_views_flushed",
      catalogCount: flushEntries.length,
      totalViews: flushEntries.reduce((total, [, views]) => total + views, 0),
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    for (const [publicKey, views] of flushEntries) {
      pendingViewsByPublicKey.set(publicKey, (pendingViewsByPublicKey.get(publicKey) || 0) + views);
    }

    logJson({
      event: "catalog_views_flush_failed",
      message: error.message,
      createdAt: new Date().toISOString()
    });
  } finally {
    flushInProgress = false;
  }
};

export const startCatalogStatsFlushInterval = () => {
  const interval = setInterval(() => {
    flushCatalogViews().catch((error) => {
      logJson({
        event: "catalog_views_flush_unhandled_error",
        message: error.message,
        createdAt: new Date().toISOString()
      });
    });
  }, flushIntervalMs);

  interval.unref();
  return interval;
};
