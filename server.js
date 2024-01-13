/* Components 
   ----------
 * 1. Home (Public) READ ONLY
 	a. GET /posts, /post/:id
 * 2. Post (Public) READ ONLY
 * 3. Admin Login (Public) 
 	a. GET /callback (return token in redirect url)
 * 4. Editor (Admin Only)
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
const env = require('dotenv').config();
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('client/public'));

const PORT = process.env.PORT || 3002;
const USERNAME = process.env.USERNAME || 'admin';
const PASSWORD = process.env.PASSWORD || 'password';
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Add a JWT secret to your environment
const token = "";

// initialize database connection
const dbPath = path.resolve(__dirname, 'db', 'posts.db');
const dbPromise = open({
  filename: dbPath,
  driver: sqlite3.Database,
});


// render home and fetch posts
app.get('/', async (req, res) => {
  try {
    // Check if the database connection is established
    if (!db) {
      throw new Error('Database connection not yet established');
    }
    // Fetch posts from the database
    const posts = await db.all('SELECT * FROM posts'); // Adjust SQL query as needed
    // Ideally, you would then pass these posts to a template engine like EJS, Pug, or Handlebars to render the page
    res.send(posts); // For now, we just send the raw posts data
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts');
  }
});


// render editor 
app.get('/editor', (req, res) => {
	res.sendFile(path.join(__dirname, 'client', 'templates', 'editor.html'));
});


// render admin login 
app.get('/admin', (req, res) => {
  // Send the index.html file for the root route
	res.sendFile(path.join(__dirname, 'client', 'templates', 'login.html'));
});


// process admin login flow
app.post('/login', (req, res) => {
	const { username, password } = req.body;
	console.log(username);
	console.log(password);

	// Verify Credentials 
	if (username === USERNAME && password === PASSWORD) {
		// Create JWT Token
		token = jwt.sign({ username }, process.env.JWT_SECRET, {
		expiresIn: '1h',
		});
		// pass token to 
		res.redirect(`/callback?token=${token}`);
	} else {
	// Authentication failed
	res.status(401).send('Login Unsuccessful');
	}
});

// /login callback function
app.get('/callback', (req, res) => {
	const { token } = req.query;
	try {
		// Verify the token
		jwt.verify(token, JWT_SECRET);
		// If the token is valid, redirect to the editor page with the token in the URL
		res.redirect(`/editor?token=${token}`);
	} catch (error) {
		// If the token is invalid, return an error message
		console.log('Token error:', error.message); // Log the error message
		res.status(401).send('Invalid or expired token');
	}
});

// post submission flow
app.post('/submit_blog', (req, res) => {
	const title = req.body.title;
	const content = req.body.content;
	const image = req.body.image;
	console.log(req.body);
	console.log(title);
	console.log(content);
	console.log(image);

	// to do
	// code to handle db submission

	res.send("Blog submitted!");
}); 


const setup = async () => {
	const db = await dbPromise;
	await db.migrate({ force: 'last', migrationsPath: './migrations' });
	app.listen(PORT, () => {
  	console.log(`Server is running on port ${PORT}`);
	});
}

setup();