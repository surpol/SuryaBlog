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
const multer  = require('multer')
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const bcrypt = require('bcrypt');

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
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

// set up storage options with Multer
const uploadPath = path.resolve(__dirname, 'public', 'images');
const maxImageSize = 10 * 1024 * 1024; // 10 MB, adjust as needed
const base64Multiplier = 4 / 3; // Base64 increases size by 33%

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    }
  }),
  limits: { 
    fileSize: maxImageSize, // Max file size for uploads
    fieldSize: maxImageSize * base64Multiplier // Max field size for base64 strings
  },
  fileFilter: (req, file, cb) => {
    if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
      return cb(new Error('Only image files are allowed!'), false);
    }
    cb(null, true);
  }
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

app.get('/blog', async (req, res) => {
  try {
    const db = await dbPromise;
		const postsWithTagsPromise = db.all(`
		  SELECT Posts.*, GROUP_CONCAT(Tags.name) as tags
		  FROM Posts
		  LEFT JOIN PostTags ON Posts.id = PostTags.post_id
		  LEFT JOIN Tags ON Tags.id = PostTags.tag_id
		  GROUP BY Posts.id
		  ORDER BY Posts.date_created DESC
		`);


    const postsWithTags = await postsWithTagsPromise;
    
    // Process the posts to include a tags array
    const posts = postsWithTags.map(post => {
      return {
        ...post,
        tags: post.tags ? post.tags.split(',') : []
      };
    });

    console.log("POSTS:", posts);
    res.render('blog', { posts });
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts');
  }
});

app.get('/blog/:id', async (req, res) => {
  const db = await dbPromise;
  try {
    const postId = req.params.id;
    const post = await db.get("SELECT * FROM Posts WHERE id = ?", postId);
    if (post) {
      // If post was found, render it using the 'post.ejs' template
      res.render('post', { post });
    } else {
      // If no post was found, send a 404 error
      res.status(404).send('Post not found');
    }
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching post');
  }
});

app.get('/tag/:tagId', async (req, res) => {
  try {
    const db = await dbPromise;
    const tagName = decodeURIComponent(req.params.tagId);
    
    // Query to select posts with the given tag name
    const posts = await db.all(`
      SELECT Posts.* FROM Posts
      JOIN PostTags ON Posts.id = PostTags.post_id
      JOIN Tags ON PostTags.tag_id = Tags.id
      WHERE Tags.name = ?
    `, tagName);

    // Render the page with the filtered posts
    res.render('tags', { posts, tagName }); // You'll need a 'tag.ejs' view for this
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts by tag');
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
    const postsWithTagsPromise = db.all(`
      SELECT Posts.*, GROUP_CONCAT(Tags.name) as tags
      FROM Posts
      LEFT JOIN PostTags ON Posts.id = PostTags.post_id
      LEFT JOIN Tags ON Tags.id = PostTags.tag_id
      GROUP BY Posts.id
    `);

    const postsWithTags = await postsWithTagsPromise;
    
    // Process the posts to include a tags array
    const posts = postsWithTags.map(post => {
      return {
        ...post,
        tags: post.tags ? post.tags.split(',') : []
      };
    });

    console.log("POSTS:", posts);
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
    // Get the post data
    const post = await db.get("SELECT * FROM Posts WHERE id = ?", req.params.id);
    
    // Check if post was found
    if (post) {
      // Get the tags for the post
      const tags = await db.all(`
        SELECT t.name 
        FROM Tags t
        INNER JOIN PostTags pt ON t.id = pt.tag_id
        WHERE pt.post_id = ?
      `, [req.params.id]);

      // Add tags array to the post object
      post.tags = tags.map(tag => tag.name);

      res.json(post);
    } else {
      res.status(404).send('Post not found');
    }
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching post');
  }
});

// delete post
app.delete('/post/:id', verifyToken, async (req, res) => {
  const postId = req.params.id;
  const db = await dbPromise;
  
  // Start a transaction
  await db.run('BEGIN TRANSACTION');
  try {
    // Delete the post
    await db.run("DELETE FROM Posts WHERE id = ?", postId);
    
    // Delete the PostTags relations for this post
    await db.run("DELETE FROM PostTags WHERE post_id = ?", postId);
    
    // Delete orphan tags
    await db.run(`
      DELETE FROM Tags
      WHERE id NOT IN (
        SELECT tag_id FROM PostTags
      )
    `);
    
    // Commit the transaction
    await db.run('COMMIT');
    
    res.send({ message: 'Post and orphan tags deleted successfully' });
  } catch (error) {
		// Rollback the transaction on error
		await db.run('ROLLBACK');
		console.error('Database query error:', error.message);
		res.status(500).send('Error deleting post');
		}
	});

// update post
app.put('/post/:id', verifyToken, upload.single('image'), async (req, res) => {
  const db = await dbPromise;
  // Start a transaction
  await db.run('BEGIN TRANSACTION');
  try {
    const { title, preview, text, tags: tagsJSON } = req.body;
    let imagePath = req.file ? path.join('/images', req.file.filename) : undefined; 

    // Update the post
    const updateQuery = `UPDATE Posts SET title = ?, preview = ?, text = ? ${imagePath ? ", imagePath = ?" : ""} WHERE id = ?`;
    const params = imagePath ? [title, preview, text, imagePath, req.params.id] : [title, preview, text, req.params.id];
    await db.run(updateQuery, params);

    // Manage tags
    const tags = JSON.parse(tagsJSON);
    await updatePostTags(db, req.params.id, tags);

    // Commit the transaction
    await db.run('COMMIT');

    res.status(200).send({ message: 'Post updated successfully' });
  } catch (error) {
    // Rollback the transaction on error
    await db.run('ROLLBACK');
    console.error('Database query error:', error.message);
    res.status(500).send('Error updating post');
  }
});

async function updatePostTags(db, postId, tags) {
  // Remove existing tags for this post
  await db.run("DELETE FROM PostTags WHERE post_id = ?", postId);

  // Add new tags
  for (const tag of tags) {
    let tagId;
    const existingTag = await db.get("SELECT id FROM Tags WHERE name = ?", tag);
    if (existingTag) {
      tagId = existingTag.id;
    } else {
      const result = await db.run("INSERT INTO Tags (name) VALUES (?)", tag);
      tagId = result.lastID;
    }
    await db.run("INSERT INTO PostTags (post_id, tag_id) VALUES (?, ?)", [postId, tagId]);
  }
   // Delete orphan tags
  await db.run(`
    DELETE FROM Tags
    WHERE id NOT IN (
      SELECT tag_id FROM PostTags
    )
  `);
}


// submit post 
app.post('/submit', verifyToken, upload.single('image'), async (req, res) => {
  const db = await dbPromise;

  const title = req.body.title;
  const preview = req.body.preview;
  const text = req.body.text;
  const imagePath = req.file ? path.join('/images', req.file.filename) : ''; // Construct the path for the img src attribute
  const currentDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format
  console.log(req.body);

  try {
    // Insert the post and get the id of the inserted post
    const result = await db.run(
    	'INSERT INTO Posts (title, preview, text, imagePath, date_created) VALUES (?, ?, ?, ?, ?)',
      [title, preview, text, imagePath, currentDate]
    );
    const postId = result.lastID;

    // Parse the tags from the request
    const tags = JSON.parse(req.body.tags);

    // Insert each tag into the Tags table if it doesn't exist
    // And then link the post to the tag in the PostTags table
    for (const tagName of tags) {
      let tagId;

      // Check if the tag already exists
      const existingTag = await db.get('SELECT id FROM Tags WHERE name = ?', [tagName]);
      
      if (existingTag) {
        // Use the existing tag's ID
        tagId = existingTag.id;
      } else {
        // Insert the new tag and get its ID
        const tagResult = await db.run('INSERT INTO Tags (name) VALUES (?)', [tagName]);
        tagId = tagResult.lastID;
      }

      // Check if the relation already exists in PostTags to prevent the constraint error
		  const relationExists = await db.get("SELECT 1 FROM PostTags WHERE post_id = ? AND tag_id = ?", postId, tagId);
		  if (!relationExists) {
		    // Insert the relation into PostTags
		    await db.run("INSERT INTO PostTags (post_id, tag_id) VALUES (?, ?)", postId, tagId);
		  }
    }

    res.json({ message:'Post successfully created with tags.' });
  } catch (error) {
    console.error('Database insert error:', error.message);
		res.status(500).send('Error saving the post with tags');
	}
});



// admin login flow
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    // Verify Credentials 
    // Note: Ensure that USER and HASHED_PASSCODE are loaded from your .env file
    if (username === USER) {
        // Compare the provided password with the hashed password
        bcrypt.compare(password, PASSCODE, (err, isMatch) => {
        	console.log("PASSCODE" + PASSCODE);
        	console.log("password" + password);

            if (err) {
                // Handle error
                res.status(500).send('An error occurred during login.');
            } else if (isMatch) {
                // Passwords match, create JWT Token
                const token = jwt.sign({ username }, JWT_SECRET, {
                    expiresIn: '1h',
                });

                // Set token in HTTP-only cookie
                res.cookie('token', token, {
                    httpOnly: true, // The cookie is not accessible via JavaScript
                    secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
                    maxAge: 3600000 // Cookie expires in 1 hour, should match JWT expiration
                });

                // Redirect to the editor
                res.redirect('/editor');
            } else {
                // Authentication failed
                res.status(401).send('Login Unsuccessful');
            }
        });
    } else {
        // Username does not match
        res.status(401).send('Authentication failed');
    }
});

// redirect to blog page
app.get('/', (req, res) => {
  res.redirect('/blog');
});

// redirect to gallery page
app.get('/gallery', (req, res) => {
    res.render('gallery');
});

// redirect to portfolio page
app.get('/portfolio', (req, res) => {
    res.render('portfolio');
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