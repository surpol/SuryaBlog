/* Components 
   ----------
 1. Home (Public) READ ONLY
 	a. GET /posts, /post/:id
 2. Post (Public) READ ONLY
 3. Admin Login (Public) 
 	a. GET /callback (return token in redirect url)
 4. Editor (Admin Only)
 	a. POST /post
 	b. DELETE PUT /post/:id
*/ 

/* 
Post schema
	- Title
	- Text
	- Image
	- Date Published 
*/

// PUBLIC api's
// app.get('/posts')
// app.get('/posts/:id')
// PROTECTED api's (require login)
// app.post('/post')
// app.delete('/post/:id')
// app.put('/post/:id')

const express = require('express');
const bodyParser = require('body-parser');
const path = require('path'); // Add path module to handle file paths
const cookieParser = require('cookie-parser');
const env = require('dotenv').config();
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('client/public'));

const PORT = process.env.PORT || 3002;
const USER = process.env.USERNAME || 'admin';
const PASSCODE = process.env.PASSCODE || 'password';
let JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Add a JWT secret to your environment
let token = "";

// Set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Initialize database connection
const dbPath = path.resolve(__dirname, 'db', 'posts.db');
const dbPromise = open({
  filename: dbPath,
  driver: sqlite3.Database,
});

// Middleware to verify the token
const verifyToken = (req, res, next) => {
  const token = req.cookies['token']; // Get the token from the cookie
  console.log("token:", token);
  if (!token) {
      return res.status(403).send('A token is required for authentication');
  }
  
  try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next(); // Token is valid, proceed to the route handler
  } catch (error) {
      res.status(401).send('Invalid or expired token');
  }
};

/* Route Handlers */

// render home and fetch posts
app.get('/', async (req, res) => {
  try {
  	const db = await dbPromise;
  	const posts = await db.all("SELECT * FROM Posts;");
  	console.log("POSTS:", posts);
		res.render('home', { posts });
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts');
  }
});

// render admin login page 
app.get('/admin', (req, res) => {
  // Send the index.html file for the root route
	res.render('login');
});


// render editor 
app.get('/editor', verifyToken, (req, res) => {
	res.render('editor');
});

// submit post 
app.post('/submit', verifyToken, async (req, res) => {
  const db = await dbPromise;
  const title = req.body.title;
  const text = req.body.text;
  const currentDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
  console.log(req.body);

  try {
      await db.run('INSERT INTO Posts (title, text, date_created) VALUES (?, ?, ?)', [title, text, currentDate]);
      res.send('Post successfully created.');
  } catch (error) {
      console.error('Database insert error:', error.message);
      res.status(500).send('Error saving the post');
  }
});


// process admin login flow
app.post('/login', (req, res) => {
	const { username, password } = req.body;
	console.log(username);
	console.log(password);

	// Verify Credentials 
	if (username === USER && password === PASSCODE) {
		// Create JWT Token
		token = jwt.sign({ username }, process.env.JWT_SECRET, {
		expiresIn: '1h',
		});

		// Set token in HTTP-only cookie
    res.cookie('token', token, {
        httpOnly: true, // The cookie is not accessible via JavaScript
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 3600000 // Cookie expires in 1 hour, should match JWT expiration
    });

		// pass token to 
		res.redirect('/editor');
	} else {
	// Authentication failed
	res.status(401).send('Login Unsuccessful');
	}
});

const setup = async () => {
	const db = await dbPromise;
	await db.migrate({migrationsPath: './migrations'});
	app.listen(PORT, () => {
  	console.log(`Server is running on port ${PORT}`);
	});
}

setup();