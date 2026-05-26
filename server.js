const http = require('http');
const fs = require('fs');
const path = require('path');

const server = http.createServer((req, res) => {
  console.log('Request:', req.url);

  let filePath = path.join(__dirname, req.url === '/' ? 'produkti.html' : req.url);

  // Remove query parameters
  filePath = filePath.split('?')[0];

  console.log('File path:', filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      console.log('File not found:', filePath, err.message);
      res.writeHead(404);
      res.end('File not found');
      return;
    }

    const ext = path.extname(filePath);
    let contentType = 'text/plain';
    if (ext === '.html') contentType = 'text/html';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.js') contentType = 'text/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.png') contentType = 'image/png';

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(8000, () => {
  console.log('Server running on http://127.0.0.1:8000');
});