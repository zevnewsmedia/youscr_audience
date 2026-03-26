const express = require('express');
const path = require('path');
const app = express();
const port = 3000;

app.use(express.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.get('/fan/login', (req, res) => {
  res.render('fan_login', { error: null, name: '', email: '' });
});

app.listen(port, () => console.log(`Server running at http://localhost:${port}`));

