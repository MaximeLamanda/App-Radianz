import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAnalytics, Analytics } from "firebase/analytics";
import { getAuth, Auth } from "firebase/auth";
import { getFirestore, Firestore } from "firebase/firestore";
import { getStorage, FirebaseStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: "AIzaSyAeAM8hteh7NldK_uCSvQt5QyUiw4vm_mw",
  authDomain: "solarview-8aec9.firebaseapp.com",
  projectId: "solarview-8aec9",
  storageBucket: "solarview-8aec9.firebasestorage.app",
  messagingSenderId: "449093508139",
  appId: "1:449093508139:web:2efa295af645bb880f5e6e",
  measurementId: "G-GMKVR01GFK"
};

let app: FirebaseApp;
let analytics: Analytics | null = null;
let db: Firestore;
let storage: FirebaseStorage;
let auth: Auth;

if (typeof window !== "undefined") {
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
    try {
      if (navigator.onLine) {
        analytics = getAnalytics(app);
      }
    } catch {
      analytics = null; // Bloqué dans certains navigateurs (Cursor, iframe, etc.)
    }
  } else {
    app = getApps()[0];
  }
  db = getFirestore(app);
  storage = getStorage(app);
  auth = getAuth(app);
} else {
  // Server-side initialization
  if (!getApps().length) {
    app = initializeApp(firebaseConfig);
  } else {
    app = getApps()[0];
  }
  db = getFirestore(app);
  storage = getStorage(app);
  auth = getAuth(app);
}

export { app, analytics, auth, db, storage };
