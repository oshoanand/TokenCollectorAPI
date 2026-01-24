import express from "express";
import prisma from "../utils/prisma.js";
import { messaging } from "../lib/firebase.js";
import jwt from "jsonwebtoken";
import { hash, genSalt, compare } from "bcrypt";

import {
  validate,
  loginValidationRules,
  registerValidationRules,
} from "../utils/auth-validator.js";
import { readFile } from "node:fs/promises";
import path from "path";

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
            userRole: role,
            userStatus: "Active",
          },
        });

        const token = generateToken(result.id, name, email);

        if (fcmToken != "") {
          const message = {
            notification: {
              title: `Добро пожаловать ${name}`,
              body: `Спасибо, что присоединились к приложению Яша !`,
            },
            token: fcmToken,
          };
          await messaging.send(message);
        }

        // console.log(result);

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
    } finally {
      async () => {
        await prisma.$disconnect();
      };
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
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

router.post("/password/update", async (req, res) => {
  const { mobile, password } = req.body;

  try {
    const user = await prisma.user.findUnique({
      where: {
        mobile: mobile,
      },
    });

    if (user) {
      const salt = await genSalt(10);
      const hashedPassword = await hash(password, salt);

      await prisma.user.update({
        where: {
          mobile: mobile,
        },
        data: {
          password: hashedPassword,
        },
      });
      return res.status(200).json({
        message: "Пароль успешно обновлен !",
      });
    } else {
      return res.status(403).json({
        message: "Мобильный номер не зарегистрирован!",
      });
    }
  } catch (error) {
    console.log(error.message);
    return res.status(400).json({ message: "Something went wrong !" });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

router.get("/all-users", async (req, res) => {
  let page = req.query.page || 1;
  let limit = req.query.limit || 50;

  try {
    const result = await prisma.user.findMany({
      skip: page == 1 ? 0 : Number(page) * 50,
      take: Number(limit),
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json({
      totalCount: result.length,
      users: result,
    });
  } catch (error) {
    console.log(error);
    return res.status(400).json({ error: error.message });
  } finally {
    async () => {
      await prisma.$disconnect();
    };
  }
});

export default router;
