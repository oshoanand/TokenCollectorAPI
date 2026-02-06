// import "dotenv/config";

// const sendMessageToBot = async (type, message, job, location, cost) => {
//   const botToken = process.env.TELEGRAM_BOT_TOKEN;
//   const chatId = process.env.TELEGRAM_CHAT_ID;
//   if (!botToken || !chatId) {
//     console.error("Telegram bot token or chat ID is not configured.");
//     return {
//       message: "Server configuration error: Could not send message.",
//       isSuccess: false,
//       errors: null,
//     };
//   }
//   let telegramMessage = "";
//   if ((type = "created")) {
//     telegramMessage += `
//     ${message}:
//      Работа: ${job}
//      Расположение: ${location}
//      Расходы: ${cost}₽
//     `;
//   } else {
//     telegramMessage += `
//     ${message}:
//      Работа: ${job}
//      Расположение: ${location}
//      Расходы: ${cost}₽
//     `;
//   }

//   const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

//   try {
//     const response = await fetch(url, {
//       method: "POST",
//       headers: {
//         "Content-Type": "application/json",
//       },
//       body: JSON.stringify({
//         chat_id: chatId,
//         text: telegramMessage,
//         parse_mode: "Markdown",
//       }),
//     });

//     const result = await response.json();

//     if (!result.ok) {
//       console.error("Telegram API error:", result.description);
//       return {
//         message: "There was an error sending your message via Telegram.",
//         isSuccess: false,
//         errors: null,
//       };
//     }
//   } catch (error) {
//     console.error("Failed to send message to Telegram:", error);
//     return {
//       message: "An unexpected network error occurred.",
//       isSuccess: false,
//       errors: null,
//     };
//   }
// };
// export { sendMessageToBot };

import "dotenv/config";

/**
 * Sends a structured message to a Telegram Bot.
 *
 * @param {string} type - "created" or "completed"
 * @param {string} title - The main header text (e.g., "New Job")
 * @param {string} jobDescription - Description of the job
 * @param {string} location - Job location
 * @param {string|number} cost - Cost in Rubles
 */
const sendMessageToBot = async (
  type,
  title,
  jobDescription,
  location,
  cost,
) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.error("❌ Telegram bot token or chat ID is not configured.");
    return {
      message: "Server configuration error: Could not send message.",
      isSuccess: false,
    };
  }

  // 1. Define Icons and Header based on Type
  let icon = "";
  let header = "";

  if (type === "created") {
    // Blue theme for New Jobs
    icon = "🆕";
    header = `<b>🔵 ${title}</b>`;
  } else {
    // Green theme for Completed/Other jobs
    icon = "✅";
    header = `<b>🟢 ${title}</b>`;
  }

  // 2. Construct the Message (Using HTML for better formatting)
  // We use <code> for the ID or specific values to make them copyable if needed.
  const telegramMessage = `
${header}

${icon} <b>Задача:</b>
${jobDescription}

📍 <b>Местоположение:</b>
${location}

💰 <b>Оплата:</b>
<code>${cost} ₽</code>

📅 <b>Дата:</b> ${new Date().toLocaleDateString("ru-RU")}
`;

  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: telegramMessage,
        parse_mode: "HTML", // Changed to HTML for better bold/code support
        disable_web_page_preview: true,
      }),
    });

    const result = await response.json();

    if (!result.ok) {
      console.error("❌ Telegram API error:", result.description);
      return {
        message: "Telegram API Error",
        isSuccess: false,
      };
    }

    console.log("✅ Message sent to Telegram successfully");
    return { isSuccess: true };
  } catch (error) {
    console.error("❌ Failed to send message to Telegram:", error);
    return {
      message: "Network Error",
      isSuccess: false,
    };
  }
};

export { sendMessageToBot };
