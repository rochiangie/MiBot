const express = require('express');
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot de WhatsApp activo!');
});

// Mantener vivo el servidor
setInterval(() => {
  console.log('Keep-alive ping');
}, 60000); // Cada minuto

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  // Aquí inicializas tu bot de WhatsApp
  initializeClient();
});

module.exports = app;