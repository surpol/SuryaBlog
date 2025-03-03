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
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const sharp = require('sharp'); // Make sure to have sharp installed (`npm install sharp`)
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
// Cache entries expire after 60 seconds (adjust as needed)
const viewCache = new NodeCache({ stdTTL: 360 }); 

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static('public'));

// initialize environment variables
const PORT = process.env.PORT || 3000;
const USER = process.env.USERNAME || 'admin';
const PASSCODE = process.env.PASSCODE || 'password';
let JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret'; // Add a JWT secret to your environment
const SECRET_BASE32 = process.env.SECRET_BASE32 || speakeasy.generateSecret();

let token = "";

// set EJS as the templating engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// ensure app is prepared to trust the proxy headers
app.set('trust proxy', true);

// initialize database connection
const dbPath = path.resolve(__dirname, 'db', 'posts.db');
const dbPromise = open({
  filename: dbPath,
  driver: sqlite3.Database,
});

// Set up storage options with Multer
const uploadPath = path.resolve(__dirname, 'public', 'images');
const maxImageSize = 10 * 1024 * 1024; // 10 MB, adjust as needed
const base64Multiplier = 4 / 3; // Base64 increases size by 33%

// Post upload configurations
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

/* ----- Middleware -----*/
const verifyToken = (req, res, next) => {
  const token = req.cookies['token']; // Get the token from the cookie
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

// Default route
app.get('/', (req, res) => {
  res.redirect('/about');
});

app.get('/about', (req, res) => {
  res.render('about');
});

app.get('/admin', (req, res) => {
	const errorMessage = "";
	res.render('login', {errorMessage});
});


app.get('/portfolio', (req, res) => {
    res.render('portfolio');
});

// Render blog & get all posts 
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
    res.render('blog', { posts });
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts');
  }
});

// Get blog by ID with view count tracking
app.get('/blog/:id', async (req, res) => {
  const db = await dbPromise;
  const postId = req.params.id;
  const userIp = req.ip; // Get the user's IP address

  try {
    // Fetch the post from the Posts table
    const post = await db.get("SELECT * FROM Posts WHERE id = ?", postId);

    if (post) {
      // Track the view count if the user hasn't viewed it recently
      const cacheKey = `view_${postId}_${userIp}`;
      const alreadyViewed = viewCache.get(cacheKey);

      if (!alreadyViewed) {
        // Increment the view count because this IP has not viewed the post recently
        await db.run("UPDATE Posts SET views = views + 1 WHERE id = ?", postId);

        // Set the cache entry for this IP and post to prevent further increments within the TTL
        viewCache.set(cacheKey, true);
      }

      // Fetch associated comments from the Comments table
      const comments = await db.all("SELECT * FROM Comments WHERE postId = ? ORDER BY created_at DESC", postId);

      // Load the post content into Cheerio for HTML manipulation
      const $ = cheerio.load(post.text);

      // Apply styles to headings
      $('h1').addClass('text-2xl font-bold');
      $('h2').addClass('text-xl font-bold');
      $('h3').addClass('text-lg font-semibold');

      // Style code blocks
      $('pre').addClass('my-4 p-4 bg-gray-50 rounded-xl overflow-x-auto whitespace-pre text-xs sm:text-sm');
      $('code').addClass('font-mono text-xs sm:text-sm bg-gray-50 px-1 py-0.5 rounded');

      // Update the post content with styled elements
      post.text = $.html();

      // Render the post with comments and views
      res.render('post', { post, comments });
    } else {
      // If no post was found, send a 404 error
      res.status(404).render('404', { message: 'Post not found' });
    }
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).render('500', { message: 'Error fetching post and/or comments' });
  }
});


// Retrieve blog posts by tag, including associated tags
app.get('/blog/tag/:tagId', async (req, res) => {
  try {
    const db = await dbPromise;
    const tagName = decodeURIComponent(req.params.tagId);
    
    // Query to select posts with the given tag name, along with associated tags
    const postsWithTags = await db.all(`
      SELECT Posts.*, GROUP_CONCAT(Tags.name) as tags
      FROM Posts
      JOIN PostTags ON Posts.id = PostTags.post_id
      JOIN Tags AS MainTag ON MainTag.id = PostTags.tag_id
      LEFT JOIN PostTags AS AllPostTags ON Posts.id = AllPostTags.post_id
      LEFT JOIN Tags ON AllPostTags.tag_id = Tags.id
      WHERE MainTag.name = ?
      GROUP BY Posts.id
      ORDER BY Posts.date_created DESC
    `, tagName);

    // Process the posts to include a tags array
    const posts = postsWithTags.map(post => ({
      ...post,
      tags: post.tags ? post.tags.split(',') : []
    }));

    // Render the page with the filtered posts and tagName
    res.render('tags', { posts, tagName });
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts by tag');
  }
});

// New comment with optional password
app.post('/blog/:id/comment', upload.none(), async (req, res) => {
  const { email, name, comment, password } = req.body;
  const postId = req.params.id;
  // Validate input
  if (!email || !name || !comment) {
    return res.status(400).send('Email, name, and comment are required.');
  }

  try {
    const db = await dbPromise;
    let hashedPassword = null;
    
    // Hash the password if provided
    if (password) {
      hashedPassword = await bcrypt.hash(password, 10);
    }

    // Insert comment into the database
    await db.run('INSERT INTO Comments (postId, email, name, comment, password) VALUES (?, ?, ?, ?, ?)',
                 [postId, email, name, comment, hashedPassword]);

    res.status(201).send('Comment added successfully.');
  } catch (error) {
    console.error('Database insert error:', error.message);
    res.status(500).send('Error adding comment to the database');
  }
});

// Verify comment password, if it exists
async function verifyOptionalCommentPassword(commentId, providedPassword) {
  const db = await dbPromise;
  const comment = await db.get('SELECT password FROM Comments WHERE id = ?', [commentId]);

  if (!comment) {
    return { success: false, message: 'No comment found with the given ID' };
  }

  // If no password was set during comment creation, bypass password check
  if (comment.password === null) {
    return { success: false, message: 'No password set for this comment' };
  }

  // If a password was provided, compare it to the stored hash
  if (providedPassword) {
    const match = await bcrypt.compare(providedPassword, comment.password);
    if (!match) {
      return { success: false, message: 'Incorrect password' };
    }
    return { success: true, message: 'Password verified successfully' };
  }

  // If no password was provided but one exists for the comment, deny access
  return { success: false, message: 'Password is required for this comment' };
}

// Update comment with password verification
app.put('/blog/:postId/comment/:commentId', upload.none(), async (req, res) => {
  const { comment, password } = req.body;
  const { postId, commentId } = req.params;
  if (!comment || !password) {
    return res.status(400).json({ success: false, message: 'Comment and Password are required' });
  }

  try {
    // Verify the password
    const passwordResult = await verifyOptionalCommentPassword(commentId, password);
    if (!passwordResult.success) {
      return res.status(403).json(passwordResult);
    }

    // Update the comment if the password is correct
    const updateResult = await updateCommentById(commentId, comment, postId);
    if (!updateResult.success) {
      return res.status(404).json(updateResult);
    }

    res.json(updateResult);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Delete comment with password verification
app.delete('/blog/:postId/comment/:commentId', upload.none(), async (req, res) => {
  const { password } = req.body;
  const { postId, commentId } = req.params;

  if (!password) {
    return res.status(400).json({ success: false, message: 'Password is required' });
  }

  try {
    // Verify the password
    const passwordResult = await verifyOptionalCommentPassword(commentId, password);
    if (!passwordResult.success) {
      return res.status(403).json(passwordResult);
    }

    // Delete the comment if the password is correct
    const deleteResult = await deleteCommentById(commentId, postId);
    if (!deleteResult.success) {
      return res.status(404).json(deleteResult);
    }

    res.json(deleteResult);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error', error: error.message });
  }
});

// Update a comment by ID
async function updateCommentById(commentId, newCommentText, postId) {
	console.log("Updating comment...");
  try {
  	const db = await dbPromise;
    const statement = `UPDATE Comments SET comment = ? WHERE id = ? AND postId = ?`;
    const result = await db.run(statement, [newCommentText, commentId, postId]);
    
    if (result.changes) {
      return { success: true, message: 'Comment updated successfully' };
    } else {
      return { success: false, message: 'Comment update failed' };
    }
  } catch (error) {
    throw new Error(`Unable to update the comment: ${error.message}`);
  }
}

// Update a comment by ID
async function deleteCommentById(commentId, postId) {
	console.log("Deleting comment...");
  try {
  	const db = await dbPromise;
		const statement = `DELETE FROM Comments WHERE id = ? AND postId = ?`;
    const result = await db.run(statement, [commentId, postId]);
    
    if (result.changes) {
      return { success: true, message: 'Comment deleted successfully' };
    } else {
      return { success: false, message: 'Comment delete failed' };
    }
  } catch (error) {
    throw new Error(`Unable to delete the comment: ${error.message}`);
  }
}

/* ------------ Private APIs ------------ */

// Render Editor View
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
    res.render('editor', { posts });
  } catch (error) {
    console.error('Database query error:', error.message);
    res.status(500).send('Error fetching posts');
  }
});

// Get Post
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

// Delete Post
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

// Update Post
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

// Update Post Tags
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

// Submit Post
app.post('/post/submit', verifyToken, upload.single('image'), async (req, res) => {
  const db = await dbPromise;

  const title = req.body.title;
  const preview = req.body.preview;
  const text = req.body.text;
  const imagePath = req.file ? path.join('/images', req.file.filename) : ''; // Construct the path for the img src attribute
  const currentDate = new Date().toISOString().split('T')[0]; // Get current date in YYYY-MM-DD format

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

    res.json({ message: 'Post successfully created.' });
  } catch (error) {
    console.error('Database insert error:', error.message);
    res.status(500).json({ error: 'Error submitting post' });
	}
});


/* ------------ Login (Public) ------------ */

// Define an object to store login attempt data
const loginAttemptsByIp = {};

// Middleware to limit login attempts
const loginRateLimiter = (req, res, next) => {
    const ip = req.ip;
    const now = Date.now();
    
    if (!loginAttemptsByIp[ip]) {
        // If this IP hasn't made a login attempt yet, initialize their data
        loginAttemptsByIp[ip] = {
            count: 1,
            lastAttempt: now
        };
        next();
    } else {
        const data = loginAttemptsByIp[ip];
        const timeSinceLastAttempt = now - data.lastAttempt;

        // Allow a new attempt if it's been more than 1 minute since the last, otherwise limit
        if (timeSinceLastAttempt > 300000) { // 60000 milliseconds = 1 minute; 300000 = 5 minutes
            data.count = 1;
            data.lastAttempt = now;
            next();
        } else if (data.count > 3) { // Only allow 3 attempt every 5 minutes
            const errorMessage = 'Too many login attempts, please try again later.';
  					res.render('login', { errorMessage }); // Pass the errorMessage to the template
        } else {
            data.count++;
            data.lastAttempt = now;
            next();
        }
    }
};

// Login
app.post('/login', loginRateLimiter, (req, res) => {
  const { username, password, code } = req.body; // Renamed 'code' to 'token' for clarity
  // Verify Credentials 
  if (username === USER) {
    bcrypt.compare(password, PASSCODE, (err, isMatch) => {
      if (err) {
        // Handle error
        res.status(500).send('An error occurred during login.');
      } else if (isMatch) {
        // Passwords match, now verify 2FA token
        const verified = speakeasy.totp.verify({
          secret: process.env.SECRET_BASE32,
          token: code, // The token from the user
        });
        if (verified) {
          // 2FA token is valid, create JWT Token
          const jwtToken = jwt.sign({ username }, JWT_SECRET, {
            expiresIn: '1h',
          });

          // Set token in HTTP-only cookie
          res.cookie('token', jwtToken, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 3600000 // Cookie expires in 1 hour, should match JWT expiration
          });

          // Redirect to the editor
          res.redirect('/editor');
        } else {
          // 2FA token verification failed
          const errorMessage = '2FA verification failed';
  				res.render('login', { errorMessage }); // Pass the errorMessage to the template
        }
      } else {
        // Authentication failed
        const errorMessage = 'Incorrect Password';
  			res.render('login', { errorMessage }); // Pass the errorMessage to the template
      }
    });
  } else {
    // Authentication failed
      const errorMessage = 'Incorrect Username';
			res.render('login', { errorMessage }); // Pass the errorMessage to the template
  	}
});

/*

Update Database
------------------------
const knexConfig = {
  client: 'sqlite3',
  connection: {
    filename: './db/posts.db', // Replace with the actual path to your SQLite database file
  },
  useNullAsDefault: true, // Required for SQLite
  migrations: {
    directory: './migrations', // Path to your migrations directory
  },
}; 

const knex = require('knex')(knexConfig);

const commentsTableExists = await knex.schema.hasTable('Comments');
if (!commentsTableExists) {
  await knex.schema.createTable('Comments', (table) => {
    table.increments('id').primary();
    table.integer('postId').unsigned().references('id').inTable('Posts');
    table.string('email');
    table.string('name');
    table.text('comment');
    table.datetime('created_at').defaultTo(knex.fn.now());
  });
}
*/

// Entry Point
const setup = async () => {
	const db = await dbPromise;
	await db.migrate({migrationsPath: './migrations'});

	app.listen(PORT, () => {
  	console.log(`Server is running on port ${PORT}`);
	});
}

setup();

// Add this with your other routes
app.get('/now', (req, res) => {
    res.render('now');
});

// Keep this route for both web and API access
app.get('/status', async (req, res) => {
    try {
      const db = await dbPromise;
        const statuses = await db.all(`
            SELECT * FROM Status 
            ORDER BY created_at DESC
        `);
        res.render('status', { statuses });
    } catch (error) {
        console.error('Error fetching status updates:', error);
        res.status(500).send('Error fetching status updates');
    }
});

// Simplified status update endpoint
app.post('/whisper', async (req, res) => {
    try {
        const { text, code } = req.body;
        
        // Verify the code word
        if (code.toLowerCase() !== 'swoosh') {
            return res.status(401).json({ error: 'Invalid code' });
        }

        if (!text) {
            return res.status(400).json({ error: 'Status text is required' });
        }

        const db = await dbPromise;
        await db.run('INSERT INTO Status (text, sender) VALUES (?, ?)', [text, 'whisper']);
        res.json({ success: true });
    } catch (error) {
        console.error('Error creating status:', error);
        res.status(500).json({ error: 'Failed to create status' });
    }
});

app.get('/whisper', (req, res) => {
    res.render('whisper');
});

