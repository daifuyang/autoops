const http = require('http');

const server = http.createServer((req, res) => {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('hello\n');
});

const port = 6000;
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});