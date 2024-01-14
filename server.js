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
	- Preview
	- Text
	- Thumbnail Image
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

// set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// initialize database connection
const dbPath = path.resolve(__dirname, 'db', 'posts.db');
const dbPromise = open({
  filename: dbPath,
  driver: sqlite3.Database,
});

// middleware to verify the token
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

/* ---Route Handlers---*/

// fetch posts & render home page 
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
	res.render('login');
});


// render editor 
app.get('/editor', verifyToken, async (req, res) => {
  const db = await dbPromise;
  try {
    const posts = await db.all("SELECT * FROM Posts");
    res.render('editor', { posts });
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts');
  }
});

// get post
app.get('/post/:id', verifyToken, async (req, res) => {
  const db = await dbPromise;
  try {
    const post = await db.get("SELECT * FROM Posts WHERE id = ?", req.params.id);
    res.json(post);
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching post');
  }
});

// delete post
app.delete('/post/:id', verifyToken, async (req, res) => {
  const db = await dbPromise;
  try {
    const post = await db.get("DELETE FROM Posts WHERE id = ?", req.params.id);
    res.json(post);
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching post');
  }
});

// update post
app.put('/post/:id', verifyToken, async (req, res) => {
  const db = await dbPromise;
  try {
    const { title, preview, text,  } = req.body;
    const currentDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
    await db.run("UPDATE Posts SET title = ?, preview = ?, text = ? WHERE id = ?", [title, preview, text, req.params.id]);
    res.status(200).send({ message: 'Post updated successfully' });
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error updating post');
  }
});


// submit post 
app.post('/submit', verifyToken, async (req, res) => {
  const db = await dbPromise;
  const title = req.body.title;
  const preview = req.body.preview;
  const text = req.body.text;

  const currentDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
  console.log(req.body);
  try {
      await db.run('INSERT INTO Posts (title, preview, text, date_created) VALUES (?, ?, ?, ?)', [title, preview, text, currentDate]);
      res.send('Post successfully created.');
  } catch (error) {
      console.error('Database insert error:', error.message);
      res.status(500).send('Error saving the post');
  }
});

// admin login flow
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

// server entry point
const setup = async () => {
	const db = await dbPromise;
	await db.migrate({migrationsPath: './migrations'});
	app.listen(PORT, () => {
  	console.log(`Server is running on port ${PORT}`);
	});
}

setup();