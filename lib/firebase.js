// import admin from "firebase-admin";
// import { getMessaging } from "firebase-admin/messaging";
// import serviceAccount from "../serviceAccountKey.json" with { type: "json" };

// if (!admin.apps.length) {
//   admin.initializeApp({
//     credential: admin.credential.cert(serviceAccount),
//   });
// }

// const messaging = getMessaging();

// const sendPushNotification = async (type, title, body, fcmToken, topic) => {
//   try {
//     let message = {
//       notification: {
//         title: title,
//         body: body,
//       },
//       data: {
//         click_action: "FLUTTER_NOTIFICATION_CLICK",
//         sentAt: new Date().toISOString(),
//       },
//       android: {
//         priority: "high",
//         notification: {
//           icon: "stock_ticker_update",
//           color: "#4D96FF",
//           sound: "default",
//         },
//       },
//       apns: {
//         payload: {
//           aps: {
//             badge: 1,
//             sound: "default",
//           },
//         },
//       },
//     };

//     // Set Destination
//     if (type === "topic" && topic) {
//       message.topic = topic;
//     } else if (type === "token" && fcmToken) {
//       message.token = fcmToken;
//     } else {
//       console.warn("FCM Error: Missing Token or Topic");
//       return; // Exit silently if no target
//     }

//     // Send via Firebase
//     const response = await messaging.send(message);
//     return response;
//     console.log("Notification sent successfully:", response);
//   } catch (error) {
//     // Log the error but DO NOT throw it up to the API route
//     console.error("FCM Sending Failed:", error.message);
//   }
// };

// export { admin, messaging, sendPushNotification };

import admin from "firebase-admin";
import { getMessaging } from "firebase-admin/messaging";
import serviceAccount from "../serviceAccountKey.json" with { type: "json" };

// Prevent multiple initializations
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const messaging = getMessaging();

const sendPushNotification = async (type, title, body, fcmToken, topic) => {
  try {
    // 1. Construct the Base Message
    let message = {
      notification: {
        title: title,
        body: body,
      },
      data: {
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        sentAt: new Date().toISOString(),
        url: "/collector/my-jobs", // <--- Custom data for Web handling
      },
      // 2. Android Specifics
      android: {
        priority: "high",
        notification: {
          icon: "stock_ticker_update",
          color: "#4D96FF",
          sound: "default",
          clickAction: "FLUTTER_NOTIFICATION_CLICK",
        },
      },
      // 3. iOS Specifics
      apns: {
        payload: {
          aps: {
            badge: 1,
            sound: "default",
          },
        },
      },
      // 4. WEB PUSH SPECIFICS (NEW)
      webpush: {
        headers: {
          Urgency: "high",
        },
        notification: {
          title: title,
          body: body,
          icon: "/icons/icon-192x192.png", // Path to your web app icon in 'public' folder
          badge: "/icons/badge.png", // Small monochrome icon
          requireInteraction: true, // Keeps notification until user clicks
          // Actions allow buttons (Optional)
          /* actions: [
            { action: "open_url", title: "View Job" }
          ] */
        },
        fcmOptions: {
          link: "/collector", // <--- The URL to open when clicked on Web
        },
      },
    };

    // 5. Set Destination
    if (type === "topic" && topic) {
      message.topic = topic;
    } else if (type === "token" && fcmToken) {
      message.token = fcmToken;
    } else {
      console.warn("FCM Error: Missing Token or Topic");
      return;
    }

    // 6. Send
    const response = await messaging.send(message);
    console.log("Notification sent successfully:", response);
    return response;
  } catch (error) {
    console.error("FCM Sending Failed:", error.message);
  }
};

export { admin, messaging, sendPushNotification };
