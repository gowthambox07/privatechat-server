const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccount.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://privatechat-978af-default-rtdb.firebaseio.com"
});

const db = admin.database();
console.log("✅ Server started — watching for messages...");

// Track last seen message time per room to avoid duplicate notifications
const lastSeen = {};

db.ref("chats").on("child_changed", async (roomSnap) => {
  const roomId = roomSnap.key;
  const msgs = roomSnap.val();
  if (!msgs) return;

  const keys = Object.keys(msgs);
  const lastKey = keys[keys.length - 1];
  const lastMsg = msgs[lastKey];

  // Skip if already notified for this message
  if (lastSeen[roomId] === lastKey) return;
  lastSeen[roomId] = lastKey;

  // Skip if message is older than 30 seconds (old message, not new)
  const msgTime = lastMsg.ts || 0;
  if (Date.now() - msgTime > 30000) return;

  console.log("📩 New message in room:", roomId);

  // Get all saved FCM tokens
  const tokensSnap = await db.ref("fcmTokens").once("value");
  const tokens = tokensSnap.val();
  if (!tokens) return;

  // Send notification to everyone except the sender
  const promises = Object.entries(tokens).map(([uid, token]) => {
    if (uid === lastMsg.user) return; // don't notify yourself
    return admin.messaging().send({
      token: token,
      notification: {
        title: "Private Chat",
        body: "1 message arrived"
      },
      android: {
        notification: {
          sound: "default",
          channelId: "messages"
        }
      },
      apns: {
        payload: {
          aps: { sound: "default" }
        }
      },
      webpush: {
        notification: {
          title: "Private Chat",
          body: "1 message arrived",
          icon: "https://cdn-icons-png.flaticon.com/512/733/733585.png"
        },
        fcmOptions: {
          link: "about:blank"
        }
      }
    }).catch(err => {
      console.log("Token error for uid:", uid, err.code);
      // If token is invalid, remove it
      if (err.code === "messaging/registration-token-not-registered") {
        db.ref("fcmTokens/" + uid).remove();
      }
    });
  });

  await Promise.all(promises.filter(Boolean));
});

// Keep server alive on Render
const http = require("http");
http.createServer((req, res) => res.end("Private Chat Notification Server Running")).listen(3000);
console.log("🌐 HTTP server listening on port 3000");
