import fs from "node:fs";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { logJson } from "./logger.js";

let firestoreDb = null;
let firebaseInitialized = false;

const normalizePrivateKey = (privateKey) => privateKey?.replace(/\\n/g, "\n");

const parseServiceAccountJson = (rawJson) => JSON.parse(rawJson);

const readApplicationCredentialsProjectId = () => {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return null;
  }

  try {
    const rawCredentials = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    return parseServiceAccountJson(rawCredentials).project_id || null;
  } catch (error) {
    logJson({
      event: "firebase_credentials_project_id_read_failed",
      message: error.message,
      createdAt: new Date().toISOString()
    });
    return null;
  }
};

const getFirebaseConfig = () => {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = parseServiceAccountJson(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

    return {
      credential: admin.credential.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id || null
    };
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return {
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY)
      }),
      projectId: process.env.FIREBASE_PROJECT_ID
    };
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return {
      credential: admin.credential.applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID || readApplicationCredentialsProjectId()
    };
  }

  return null;
};

export const getFirestoreDb = () => {
  if (firebaseInitialized) {
    return firestoreDb;
  }

  firebaseInitialized = true;

  const firebaseConfig = getFirebaseConfig();
  if (!firebaseConfig) {
    logJson({
      event: "firestore_not_configured",
      message: "Using catalogs.json fallback because Firebase Admin credentials are not configured",
      createdAt: new Date().toISOString()
    });
    return null;
  }

  if (!firebaseConfig.projectId) {
    throw new Error("Firebase Admin is configured but FIREBASE_PROJECT_ID could not be resolved");
  }

  const app = admin.initializeApp({
    credential: firebaseConfig.credential,
    projectId: firebaseConfig.projectId
  });

  firestoreDb = getFirestore(app, process.env.FIRESTORE_DATABASE_ID || "(default)");

  logJson({
    event: "firestore_configured",
    projectId: firebaseConfig.projectId,
    databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
    collection: process.env.FIRESTORE_CATALOG_COLLECTION || "catalog_public_routes",
    createdAt: new Date().toISOString()
  });

  return firestoreDb;
};
