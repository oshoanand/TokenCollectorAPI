import express from "express";
import prisma from "../utils/prisma.js";
import { sendPushNotification } from "../lib/firebase.js";
import jwt from "jsonwebtoken";
import { hash, genSalt, compare } from "bcrypt";
import {
  validate,
  loginValidationRules,
  registerValidationRules,
} from "../utils/auth-validator.js";

import { sendResetPasswordLinkEmail } from "../mailer/email-sender.js";

import "dotenv/config";

const router = express.Router();

const generateToken = (_id, name, email) => {
  const jwtClaims = {
    id: _id,
    name: name,
    email: email,
    iat: Date.now() / 1000,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  };
  return jwt.sign(jwtClaims, process.env.SECRET, {
    algorithm: "HS256",
  });
};

router.post(
  "/register",
  registerValidationRules,
  validate,
  async (req, res) => {
    const { mobile, email, password, name, fcmToken, role } = req.body;
    console.log(req.body);
    try {
      const userExits = await prisma.user.count({
        where: {
          mobile: mobile,
        },
      });

      if (userExits > 0) {
        return res.status(403).json({
          message: "Мобильный номер уже используется!",
        });
      } else {
        const salt = await genSalt(10);
        const hashedPassword = await hash(password, salt);

        const result = await prisma.user.create({
          data: {
            email: email,
            name: name,
            password: hashedPassword,
            mobile: mobile,
            fcmToken: fcmToken,
            image:
              "https://res.cloudinary.com/dlywo5mxn/image/upload/v1689572976/afed80130a2682f1a428984ed8c84308_wscf7t.jpg",
            userRole: role ? role : "USER",
            userStatus: "Active",
          },
        });

        const token = generateToken(result.id, name, email);

        // 2. Send Notification (Fire & Forget)
        // We do NOT use 'await' here. If this fails, it logs to console
        // via the catch block inside lib/firebase.js, but does not stop this request.
        if (fcmToken) {
          sendPushNotification(
            "token",
            `${result.name} ! Спасибо за регистрацию 👍`,
            "Добро пожаловать в Услуги",
            fcmToken,
            null,
          );
        }

        return res.status(200).json({
          user: {
            id: result.id,
            email: result.email,
            mobile: result.mobile,
            name: result.name,
            image: result.image,
            token: token,
            role: result.userRole,
          },
        });
      }
    } catch (error) {
      console.log(error.message);
      return res.status(400).json({ message: "Something went wrong !" });
    }
  },
);

router.post("/login", loginValidationRules, validate, async (req, res) => {
  const { mobile, password, role, fcmToken } = req.body;
  // console.log(req.body);
  try {
    const result = await prisma.user.findUnique({
      where: {
        mobile: mobile,
        userRole: role,
      },
    });

    if (result) {
      const passwordMatch = await compare(password, result.password);
      if (!passwordMatch) {
        return res.status(403).json({
          message: "Неверный пароль!",
        });
      } else {
        const token = generateToken(result.id, result.name, result.email);
        await prisma.user.update({
          where: {
            mobile: mobile,
          },
          data: {
            fcmToken: fcmToken,
            userRole: role,
          },
        });
        return res.status(200).json({
          user: {
            id: result.id,
            email: result.email,
            mobile: result.mobile,
            name: result.name,
            image: result.image,
            token: token,
            role: result.userRole,
          },
        });
      }
    } else {
      return res.status(403).json({
        message: "Мобильный номер не зарегистрирован!",
      });
    }
  } catch (error) {
    console.log(error.message);
    return res.status(400).json({ message: "Something went wrong !" });
  }
});

router.post("/password/reset", async (req, res) => {
  const { mobile, password, fcmToken } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: { mobile: mobile },
    });

    if (user) {
      const salt = await genSalt(10);
      const hashedPassword = await hash(password, salt);

      // 1. Update Database (Critical Step)
      await prisma.user.update({
        where: { mobile: mobile },
        data: { password: hashedPassword },
      });

      // 2. Send Notification (Fire & Forget)
      // We do NOT use 'await' here. If this fails, it logs to console
      // via the catch block inside lib/firebase.js, but does not stop this request.
      if (fcmToken) {
        sendPushNotification(
          "token",
          "🔐ваш пароль успешно изменен",
          "попробуйте войти в систему, используя свой новый пароль! ✅",
          fcmToken,
          null,
        );
      }

      // 3. Send Success Response Immediately
      return res.status(200).json({
        message: "Пароль успешно обновлен !",
      });
    } else {
      return res.status(403).json({
        message: "Мобильный номер не зарегистрирован!",
      });
    }
  } catch (error) {
    console.log("Database/Server Error:", error.message);
    // This only runs if Prisma/Database fails, which is what you want.
    return res.status(400).json({ message: "Something went wrong !" });
  }
});

// password reset implementation for web app

//  FORGOT PASSWORD (Generate Link)
router.post("/forgot-password", async (req, res) => {
  try {
    const { mobile } = req.body;
    const user = await prisma.user.findUnique({ where: { mobile } });

    // Security: Always return 200 even if user not found to prevent email enumeration
    if (!user) {
      return res
        .status(200)
        .json({ message: "If that email exists, we sent a link." });
    }

    // Generate Token
    // CRITICAL: We include the user's current password hash in the secret.
    // If the password changes, this secret changes, invalidating all old links instantly.
    const secret = process.env.SECRET + user.password;
    const token = jwt.sign({ id: user.id, email: user.email }, secret, {
      expiresIn: "2h", // Link valid for 2 hours
    });

    const link = `${process.env.WEB_APP_URL}/reset-password/${token}`;
    //  Send Verification Email (Using the utility)
    try {
      // We do not await this if we want the response to return immediately,
      // but usually, it's safer to await to catch config errors early.

      await sendResetPasswordLinkEmail(
        link,
        user.email,
        user.name || "Пользователь",
      );
      console.log(`Reset password email queued `);
    } catch (emailError) {
      // Log error but treat registration as successful
      console.error(
        "Failed to send reset password  email :",
        emailError.message,
      );
      // Optional: You might want to flag the user in DB that email sending failed
    }

    return res.status(200).json({
      success: true,
      message: "Ссылка отправлена на почту",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

//  RESET PASSWORD (Verify & Update)
router.post("/reset-password/:token", async (req, res) => {
  const { token } = req.params;
  const { password, mobile } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { mobile: mobile } });
    if (!user) return res.status(400).json({ message: "Invalid user." });

    // Verify Token using the same composite secret
    const secret = process.env.SECRET + user.password;
    try {
      jwt.verify(token, secret);
    } catch (err) {
      return res.status(400).json({ message: "Invalid or expired link." });
    }

    // Hash new password

    const salt = await genSalt(10);
    const hashedPassword = await hash(password, salt);

    await prisma.user.update({
      where: { mobile: mobile },
      data: { password: hashedPassword },
    });

    res.status(200).json({ message: "Password updated successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

export default router;
