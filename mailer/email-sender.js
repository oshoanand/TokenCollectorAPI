import nodemailer from "nodemailer";
import fs from "fs";
import "dotenv/config";

import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Recreate __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configure Yandex Transporter
const transporter = nodemailer.createTransport({
  host: "smtp.yandex.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Reads an HTML file and replaces placeholders
 */
const getTemplate = (templateName, data) => {
  const templatePath = join(__dirname, "templates", `${templateName}.html`);

  // Read the file synchronously (for simplicity in this context)
  let htmlContent = fs.readFileSync(templatePath, "utf8");

  // Replace placeholders dynamically
  // Example: replaces {{name}} with data.name
  Object.keys(data).forEach((key) => {
    const regex = new RegExp(`{{${key}}}`, "g"); // Create global regex for replacement
    htmlContent = htmlContent.replace(regex, data[key]);
  });

  return htmlContent;
};
/**
 * Sends a verification email to the user.
 * @param {string} toEmail - The recipient's email address.
 * @param {string} userName - The recipient's name.
 * @param {string} token - The unique verification token.
 */
const sendVerificationEmail = async (toEmail, userName, token) => {
  try {
    // 1. Construct the verification link
    // Ensure APP_URL is defined in your .env (e.g., http://localhost:3000 or https://api.myapp.com)
    const verificationLink = `${process.env.WEB_APP_URL}/verify-email?token=${token}`;

    // 2. Load and populate the HTML template
    const htmlEmail = getTemplate("verification-email", {
      name: userName,
      link: verificationLink,
    });

    // 3. Define email options
    const mailOptions = {
      from: `"Eventomir | " <${process.env.EMAIL_USER}>`, // Sender address
      to: toEmail, // Receiver address
      subject: "Welcome! Please verify your email", // Subject line
      html: htmlEmail, // HTML body
    };

    // 4. Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `Verification email sent to ${toEmail}. Message ID: ${info.messageId}`,
    );

    return true;
  } catch (error) {
    console.error("Error in sendVerificationEmail:", error);
    // We re-throw the error so the calling function knows it failed
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

const sendResetPasswordLinkEmail = async (link, toEmail, userName) => {
  try {
    //  Load and populate the HTML template
    const htmlEmail = getTemplate("reset-password", {
      name: userName,
      link: link,
    });

    // 3. Define email options
    const mailOptions = {
      from: `"Услуги64" <${process.env.EMAIL_USER}>`, // Sender address
      to: toEmail, // Receiver address
      subject: "Услуги64 | Ссылка для сброса пароля", // Subject line
      html: htmlEmail, // HTML body
    };

    // 4. Send the email
    const info = await transporter.sendMail(mailOptions);
    console.log(
      `password reset link email sent to ${toEmail}. Message ID: ${info.messageId}`,
    );

    return true;
  } catch (error) {
    console.error("Error in sendResetPasswordLinkEmail:", error);
    // We re-throw the error so the calling function knows it failed
    throw new Error(`Failed to send email: ${error.message}`);
  }
};

export { sendVerificationEmail, sendResetPasswordLinkEmail };
