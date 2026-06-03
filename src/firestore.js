import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { logJson } from "./logger.js";

let firestoreDb = null;
let firebaseInitialized = false;

const normalizePrivateKey = (privateKey) => privateKey?.replace(/\\n/g, "\n");

const getCredential = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY)
    });
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return admin.credential.applicationDefault();
  }

  return null;
};

export const getFirestoreDb = () => {
  if (firebaseInitialized) {
    return firestoreDb;
  }

  firebaseInitialized = true;

  const credential = getCredential();
  if (!credential) {
    logJson({
      event: "firestore_not_configured",
      message: "Using catalogs.json fallback because Firebase Admin credentials are not configured",
      createdAt: new Date().toISOString()
    });
    return null;
  }

  const app = admin.initializeApp({
    credential,
    projectId: process.env.FIREBASE_PROJECT_ID || undefined
  });

  firestoreDb = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || "(default)");

  logJson({
    event: "firestore_configured",
    projectId: process.env.FIREBASE_PROJECT_ID || null,
    databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
    collection: process.env.FIRESTORE_CATALOG_COLLECTION || "catalog_public_routes",
    createdAt: new Date().toISOString()
  });

  return firestoreDb;
};
