import "dotenv/config";

const sendMessageToBot = async (type, message, job, location, cost) => {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    console.error("Telegram bot token or chat ID is not configured.");
    return {
      message: "Server configuration error: Could not send message.",
      isSuccess: false,
      errors: null,
    };
  }
  let telegramMessage = "";
  if ((type = "created")) {
    telegramMessage += `
    ${message}:
     Работа: ${job}
     Расположение: ${location}
     Расходы: ${cost}₽
    `;
  } else {
    telegramMessage += `
    ${message}:
     Работа: ${job}
     Расположение: ${location}
     Расходы: ${cost}₽
    `;
  }

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
        parse_mode: "Markdown",
      }),
    });

    const result = await response.json();
    console.log(result);

    if (!result.ok) {
      console.error("Telegram API error:", result.description);
      return {
        message: "There was an error sending your message via Telegram.",
        isSuccess: false,
        errors: null,
      };
    }
  } catch (error) {
    console.error("Failed to send message to Telegram:", error);
    return {
      message: "An unexpected network error occurred.",
      isSuccess: false,
      errors: null,
    };
  }
};
export { sendMessageToBot };
