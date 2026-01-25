// import admin from "firebase-admin";
// import { getMessaging } from "firebase-admin/messaging";
// import serviceAccount from "../serviceAccountKey.json" with { type: "json" };

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });
// const messaging = getMessaging();

// const sendPushNotification = async (type, title, body, fcmToken, topic) => {
//   let message = {
//     notification: {
//       title: title,
//       body: body,
//     },
//     // Optional: Add data payload for background handling or custom logic in the app
//     data: {
//       click_action: "FLUTTER_NOTIFICATION_CLICK", // Or your Android/iOS specific action
//       sentAt: new Date().toISOString(),
//     },
//     // Platform specific configurations
//     android: {
//       priority: "high",
//       notification: {
//         icon: "stock_ticker_update",
//         color: "#4D96FF", // Matches your Tech Blue theme
//         sound: "default",
//       },
//     },
//     apns: {
//       payload: {
//         aps: {
//           badge: 1,
//           sound: "default",
//         },
//       },
//     },
//   };

//   // 2. Set Destination based on Type
//   if (type === "topic") {
//     // Broadcasting to a Firebase Topic (e.g., "all_users")
//     message.topic = topic;
//   } else if (type === "token") {
//     // Sending to a specific device's FCM Token
//     message.token = fcmToken;
//   } else {
//     return res
//       .status(400)
//       .json({ error: "Invalid type. Must be 'topic' or 'token'." });
//   }

//   // 3. Send via Firebase Admin SDK
//   const response = await messaging.send(message);
// };

// export { admin, messaging, sendPushNotification };

import admin from "firebase-admin";
import { getMessaging } from "firebase-admin/messaging";
import serviceAccount from "../serviceAccountKey.json" with { type: "json" };

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const messaging = getMessaging();

const sendPushNotification = async (type, title, body, fcmToken, topic) => {
  try {
    let message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        sentAt: new Date().toISOString(),
      },
      android: {
        priority: "high",
        notification: {
          icon: "stock_ticker_update",
          color: "#4D96FF",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: "default",
          },
        },
      },
    };

    // Set Destination
    if (type === "topic" && topic) {
      message.topic = topic;
    } else if (type === "token" && fcmToken) {
      message.token = fcmToken;
    } else {
      console.warn("FCM Error: Missing Token or Topic");
      return; // Exit silently if no target
    }

    // Send via Firebase
    const response = await messaging.send(message);
    return response;
    console.log("Notification sent successfully:", response);
  } catch (error) {
    // Log the error but DO NOT throw it up to the API route
    console.error("FCM Sending Failed:", error.message);
  }
};

export { admin, messaging, sendPushNotification };
