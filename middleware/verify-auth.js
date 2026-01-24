import jwt from "jsonwebtoken";
import "dotenv/config";

function extractToken(req) {
  if (
    req.headers.authorization &&
    req.headers.authorization.split(" ")[0] === "Bearer"
  ) {
    return req.headers.authorization.split(" ")[1];
  } else if (req.query && req.query.token) {
    return req.query.token;
  }
  return null;
}

export const verifyAuth = async (req, res, next) => {
  const token = extractToken(req);
  console.log(token);
  // req.body.token || req.query.token || req.headers["x-access-token"];
  // console.log(token);

  if (!token) {
    return res.status(401).json({ error: "Unauthorized access " });
  }
  try {
    const { id } = jwt.verify(token, process.env.SECRET, {
      algorithms: "HS256",
    });
    // console.log(id);
    next();
  } catch (err) {
    console.log(err);
    return res.status(403).json({ access: "Forbidden" });
  }
};
