const express = require('express');
const bodyParser = require('body-parser');
const path = require('path'); // Add path module to handle file paths
const env = require('dotenv').config();
const jwt = require('jsonwebtoken'); // Import jsonwebtoken
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('client/public'));

const PORT = process.env.PORT || 3002;
const USERNAME = process.env.USERNAME || 'admin';
const PASSWORD = process.env.PASSWORD || 'password';
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Add a JWT secret to your environment

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

/* Post schema
	- Title
	- Text
	- Images
	- Date Created */

// Home
app.get('/', (req, res) => {
	res.sendFile(path.join(__dirname, 'client', 'templates', 'home.html'));
});

// Editor 
app.get('/editor', (req, res) => {
	res.sendFile(path.join(__dirname, 'client', 'templates', 'editor.html'));
});

// Admin 
app.get('/admin', (req, res) => {
  // Send the index.html file for the root route
	res.sendFile(path.join(__dirname, 'client', 'templates', 'login.html'));
});

// Login
app.post('/login', (req, res) => {
	const { username, password } = req.body;
	console.log(username);
	console.log(password);

	// Verify Credentials 
	if (username === USERNAME && password === PASSWORD) {
		// Create JWT Token
		const token = jwt.sign({ username }, process.env.JWT_SECRET, {
		expiresIn: '1h',
		});
		// pass token to 
		res.redirect(`/callback?token=${token}`);
	} else {
	// Authentication failed
	res.status(401).send('Login Unsuccessful');
	}
});

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



// PUBLIC api's
//app.get('/posts')
//app.get('/posts/:id')
// PROTECTED api's (require login)
//app.post('/post')
//app.delete('/post/:id')
//app.put('/post/:id')


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});