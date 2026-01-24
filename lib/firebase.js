import admin from "firebase-admin";
import { getMessaging } from "firebase-admin/messaging";
import serviceAccount from "../serviceAccountKey.json" with { type: 'json' };

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const messaging = getMessaging();

export { admin, messaging };
