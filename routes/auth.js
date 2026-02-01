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
            `${result.name} ! Добро пожаловать в Клинсити`,
            "Спасибо за регистрацию 👍🎉",
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

export default router;
