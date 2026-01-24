import prisma from "./prisma.js"; // Import your instantiated prisma client
import cron from "node-cron";

// const setupTTL = () => {
//   // Schedule a task to run every minute (or hour, depending on needs)
//   // '0 * * * *' = every hour
//   // '* * * * *' = every minute
//   cron.schedule("* * * * *", async () => {
//     console.log("Running TTL cleanup...");

//     try {
//       const now = new Date();

//       const { count } = await prisma.orderRequest.deleteMany({
//         where: {
//           receivedAt: {
//             lt: now, // "lt" stands for Less Than
//           },
//         },
//       });

//       if (count > 0) {
//         console.log(`Deleted ${count} expired records.`);
//       }
//     } catch (error) {
//       console.error("Error executing TTL cleanup:", error);
//     }
//   });
// };

const setupTTL = () => {
  // Run this check every hour ('0 * * * *') or every day ('0 0 * * *')
  // Running it every minute('* * * * *') is usually unnecessary for a 48-hour window
  cron.schedule("0 0 * * *", async () => {
    console.log("Running 48-hour cleanup...");

    try {
      // 1. Calculate the cutoff time (Now minus 48 hours)
      const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);

      // 2. Delete rows where 'createdAt' is older (less than) the cutoff
      const { count } = await prisma.orderRequest.deleteMany({
        where: {
          // Condition 1
          createdAt: {
            lt: fortyEightHoursAgo,
          },
          // Condition 2
          orderStatus: "requested",
        },
      });

      if (count > 0) {
        console.log(`Deleted ${count} records older than 48 hours.`);
      }
    } catch (error) {
      console.error("Error executing cleanup:", error);
    }
  });
};

export default setupTTL;
