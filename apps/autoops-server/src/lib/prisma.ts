import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "../generated/prisma/client";

// 解析 DATABASE_URL
const dbUrl = new URL(process.env.DATABASE_URL || "mysql://root@localhost:3306/task_center");

const adapter = new PrismaMariaDb({
  host: dbUrl.hostname,
  port: parseInt(dbUrl.port) || 3306,
  user: dbUrl.username,
  password: dbUrl.password,
  database: dbUrl.pathname.slice(1), // 去掉开头的 /
  // connectionLimit: 10,
  // 连接超时设置
  connectTimeout: 10000,
});
const prisma = new PrismaClient({ adapter });

export { prisma };
