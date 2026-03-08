#!/usr/bin/env node

/**
 * JWT Secret 生成脚本
 * 
 * 使用方法:
 *   node scripts/generate-jwt-secret.js
 * 
 * 该脚本会生成一个安全的随机 JWT Secret 并输出到控制台
 * 建议密钥长度至少 32 个字符
 */

const crypto = require('crypto');

// 生成安全的随机密钥
function generateJWTSecret(length = 64) {
  // 使用 crypto 生成随机字节，然后转换为 base64
  const randomBytes = crypto.randomBytes(length);
  // 转换为 URL-safe base64 字符串
  return randomBytes.toString('base64url').slice(0, length);
}

// 主函数
function main() {
  console.log('\n🔐 JWT Secret 生成器\n');
  
  const secret = generateJWTSecret(64);
  
  console.log('生成的 JWT Secret:');
  console.log('─'.repeat(70));
  console.log(secret);
  console.log('─'.repeat(70));
  
  console.log('\n✅ 使用方式:');
  console.log('1. 复制上面的密钥');
  console.log('2. 添加到 .env 文件:');
  console.log(`   JWT_SECRET="${secret}"`);
  console.log('\n⚠️  安全提示:');
  console.log('   - 请勿将密钥提交到版本控制');
  console.log('   - 生产环境请使用不同的密钥');
  console.log('   - 建议定期更换密钥');
  console.log();
}

main();
