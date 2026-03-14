const http = require('http');

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('hello\n');
});

const port = 6000;

server.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});

server.listen(port, '0.0.0.0', () => {  // 明确绑定所有接口
  console.log(`Server running at:`);
  console.log(`  http://localhost:${port}/`);
  console.log(`  http://127.0.0.1:${port}/`);
});